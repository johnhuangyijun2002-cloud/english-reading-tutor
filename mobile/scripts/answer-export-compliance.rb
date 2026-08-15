#!/usr/bin/env ruby
# frozen_string_literal: true

# 每次上传新 build 到 TestFlight，App Store Connect 都要求单独回答一次"是否使用加密"这个
# 合规性问题，不回答的话这个 build 不会出现在可测试列表里——之前一直是手动点，容易忘。
# 这个脚本用 App Store Connect API 自动把这个问题回答成"否/标准 HTTPS 豁免"
# (usesNonExemptEncryption: false)，跟之前手动在网页上选的答案一致。
#
# 只做这一件事，失败/超时都不让整个 CI job 失败——这一步答不上，最坏情况就是退回手动点一次，
# 不影响 build 已经成功传上 TestFlight 这个事实。

require "jwt"
require "openssl"
require "net/http"
require "json"
require "uri"

key_id = ENV.fetch("ASC_API_KEY_ID")
issuer_id = ENV.fetch("ASC_API_ISSUER_ID")
app_id = ENV.fetch("ASC_APP_ID")
build_number = ENV.fetch("BUILD_NUMBER")
key_path = ENV.fetch("ASC_KEY_PATH")

private_key = OpenSSL::PKey::EC.new(File.read(key_path))

def make_token(issuer_id, key_id, private_key)
  JWT.encode(
    { iss: issuer_id, iat: Time.now.to_i, exp: Time.now.to_i + 1190, aud: "appstoreconnect-v1" },
    private_key,
    "ES256",
    { kid: key_id }
  )
end

def api_request(method_class, path, token, body = nil)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  req = method_class.new(uri)
  req["Authorization"] = "Bearer #{token}"
  if body
    req["Content-Type"] = "application/json"
    req.body = JSON.generate(body)
  end
  res = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |http| http.request(req) }
  parsed = res.body.nil? || res.body.empty? ? {} : JSON.parse(res.body)
  [res.code.to_i, parsed]
end

# 刚上传完的 build，Apple 那边要处理一段时间才会在 API 里查得到、状态变成 VALID，
# 这个等待时间不固定，最多等 15 分钟，超时就放弃，不阻塞整个 workflow。
deadline = Time.now + 15 * 60
build_id = nil

until Time.now > deadline
  token = make_token(issuer_id, key_id, private_key)
  path = "/v1/builds?filter[app]=#{app_id}&filter[version]=#{build_number}&fields[builds]=processingState,version"
  code, body = api_request(Net::HTTP::Get, path, token)

  if code == 200 && body["data"] && !body["data"].empty?
    build = body["data"].first
    state = build.dig("attributes", "processingState")
    puts "build processingState=#{state}"
    case state
    when "VALID"
      build_id = build["id"]
      break
    when "FAILED", "INVALID"
      puts "build processing ended in #{state} — nothing to answer, exiting"
      exit 0
    end
  else
    puts "build not visible in App Store Connect yet (http #{code})"
  end

  sleep 30
end

if build_id.nil?
  puts "timed out waiting for Apple to finish processing the build — answer the export compliance question manually in App Store Connect this time"
  exit 0
end

token = make_token(issuer_id, key_id, private_key)
code, body = api_request(
  Net::HTTP::Patch,
  "/v1/builds/#{build_id}",
  token,
  { data: { type: "builds", id: build_id, attributes: { usesNonExemptEncryption: false } } }
)

if code >= 200 && code < 300
  puts "answered export compliance automatically (usesNonExemptEncryption=false)"
else
  puts "failed to auto-answer export compliance (http #{code}): #{body} — answer it manually this time"
end

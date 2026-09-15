// 广告变现——ADS_ENABLED 打开着，但 USE_TEST_ADS 也是 true，所以这次连同 App Store 正式提交
// 一起出现的只是 Google 官方测试广告位(会显示"Test Ad"字样)，不关联真实 AdMob 账号收入、
// 不产生任何真实收入。特意选择让测试广告跟着这次提交一起出现(而不是像之前那样先关掉)，
// 是为了让审核员/真实用户提前看到广告位长什么样，为将来真正开放广告收入做心理预期铺垫。
//
// 因为这样一来 AdMob SDK 真的会初始化、真的会弹 ATT 授权弹窗、真的会向 Google 的广告服务器
// 发请求(哪怕只是请求测试广告)，这已经构成"收集设备标识符类数据用于广告"，所以：
//   - frontend/privacy.html 的"Advertising (iOS)"一节已经改成如实说明"广告功能已开启(测试
//     阶段)"，不能再写"当前版本未开启广告"那种话
//   - App Store Connect 的 App Privacy 问卷也必须同步改成"收集 Identifiers/Usage Data 用于
//     广告"，不能再填"不用于广告"，否则会跟实际行为不符(Apple 审核指南 5.1.2)
//
// 真正开始产生真实广告收入(而不只是测试广告位)时还要做的事：
//   1. 确认签证/身份问题解决(见 mobile/README.md"广告变现"一节)
//   2. 把 USE_TEST_ADS 改成 false(App ID / 真实广告单元 ID 已经是真的了，不用再改)
//   3. mobile/ios/App/App/Info.plist 里的 SKAdNetworkItems 换成 Google 文档当前的完整列表
//      (现在只放了 Google 自己那一条，够测试用，不够生产用)

const ADS_ENABLED = true;
const USE_TEST_ADS = true;

// Google 官方文档公开的测试专用广告位 ID，任何开发者都能直接用：
// https://developers.google.com/admob/ios/test-ads
const TEST_BANNER_AD_UNIT_ID = "ca-app-pub-3940256099942544/2934735716";

// 用户真实 AdMob 账号下创建的广告单元 ID——USE_TEST_ADS 为 true 时不会被用到，
// 只有真正翻开关上线才会生效。
const PRODUCTION_BANNER_AD_UNIT_ID = "ca-app-pub-7356124481466705/6674096817";

let adMobReady = false;

function getAdMobPlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
}

// App 真冷启动时，原生桥(Capacitor.Plugins)有时还没完全就绪，AdMob 插件对象这时候还
// 挂不上去；之前 StoreKit 内购插件也踩过同一类时序坑。原来的写法是只查一次、查不到就
// 直接放弃——结果冷启动时 ATT 弹窗经常不出现，退出登录触发 location.reload() 之后原生
// 桥已经热了、才第一次真正弹出来。改成短暂轮询等一下，给冷启动多一点缓冲时间。
async function waitForAdMobPlugin(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const plugin = getAdMobPlugin();
    if (plugin) return plugin;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

window.ContextiaAds = {
  enabled: ADS_ENABLED,

  // 启动时调用一次
  async init() {
    if (!ADS_ENABLED) return;
    const AdMob = await waitForAdMobPlugin();
    if (!AdMob) return;
    try {
      // iOS 14+ 强制要求：想用支持个性化广告的 SDK，得先弹一次系统级授权弹窗问用户
      // "允许追踪吗"。用户拒绝也不影响广告能不能显示，只是不能个性化投放。
      await AdMob.requestTrackingAuthorization();
      await AdMob.initialize({ initializeForTesting: USE_TEST_ADS });
      adMobReady = true;
    } catch (err) {
      console.warn("AdMob 初始化失败", err);
    }
  },

  // 展示底部横幅广告——AdMob 的 banner 是原生视图，直接叠在 WebView 上面，不是插进
  // #adBannerSlot 这个 DOM 节点里的；那个节点目前只是给以后可能需要的布局占位用，
  // banner 本身的位置由下面 position 参数控制。
  async showBanner() {
    if (!ADS_ENABLED || !adMobReady) return;
    const AdMob = getAdMobPlugin();
    if (!AdMob) return;
    try {
      await AdMob.showBanner({
        adId: USE_TEST_ADS ? TEST_BANNER_AD_UNIT_ID : PRODUCTION_BANNER_AD_UNIT_ID,
        adSize: "ADAPTIVE_BANNER",
        position: "BOTTOM_CENTER",
        isTesting: USE_TEST_ADS,
      });
    } catch (err) {
      console.warn("AdMob 展示 banner 失败", err);
    }
  },

  async hideBanner() {
    const AdMob = getAdMobPlugin();
    if (AdMob) {
      try {
        await AdMob.hideBanner();
      } catch (err) {
        // 没有已展示的 banner 时调用会报错，忽略即可
      }
    }
    const slot = document.getElementById("adBannerSlot");
    if (slot) slot.classList.add("hidden");
  },
};

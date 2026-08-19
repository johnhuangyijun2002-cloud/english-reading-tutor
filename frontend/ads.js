// 广告变现——现在处于"走通技术流程"阶段，不是真正上线：ADS_ENABLED 打开了，AdMob 账号和
// App ID(见下面 Info.plist 里的 GADApplicationIdentifier)也是真的，但 USE_TEST_ADS 还是
// true，广告位请求走的是 Google 官方公开的测试广告位 ID，不是下面 PRODUCTION_BANNER_AD_UNIT_ID
// 那个真实广告位。不会有真实广告展示，也不会产生任何真实收入。
//
// 之所以先这么接，是因为广告收入目前卡在用户的韩国签证问题上(D-2 留学签证原则上不能从事
// 营利性活动，见 mobile/README.md"广告变现"一节)，这个问题没解决之前不会真的上线广告；
// 但技术流程(SDK 接入、ATT 授权弹窗、原生 banner 展示)可以先走通、先熟悉，AdMob 账号/App/
// 广告单元也可以先注册好、放着备用——这些步骤本身不涉及金钱往来，不会触发签证问题。
//
// 真正上线时要做的事：
//   1. 确认签证/身份问题解决
//   2. 把 USE_TEST_ADS 改成 false（App ID 和广告单元 ID 已经是真的了，不用再改）
//   3. mobile/ios/App/App/Info.plist 里的 SKAdNetworkItems 换成 Google 文档当前的完整列表
//      (现在只放了 Google 自己那一条，够测试用，不够生产用)
//   4. App Store Connect 的 App Privacy 问卷更新，声明用了广告/追踪 SDK，重新提审

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

window.ContextiaAds = {
  enabled: ADS_ENABLED,

  // 启动时调用一次
  async init() {
    if (!ADS_ENABLED) return;
    const AdMob = getAdMobPlugin();
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

// 广告变现——技术流程已经走通过一遍(SDK 接入、ATT 授权弹窗、原生 banner 展示，全用测试
// 广告位验证过)，AdMob 账号和 App ID/广告单元 ID(见下面 Info.plist 里的
// GADApplicationIdentifier、PRODUCTION_BANNER_AD_UNIT_ID)也是真的，但现在 ADS_ENABLED
// 关掉了——iOS 免费版要正式提交 App Store 审核，这个 build 面向的是真实用户，不是自己测试，
// 让每个真实用户平白多看一次"允许追踪吗"的系统弹窗、却拿不到任何真实广告/功能上的好处，
// 没有意义。关掉之后 AdMob 完全不会被初始化，不弹 ATT 弹窗，也不发任何请求——跟
// frontend/privacy.html 里"数据不用于广告"这句话保持一致，不用为了这个单独去改隐私政策。
//
// 之所以先这么接但不上线，是因为广告收入目前卡在用户的韩国签证问题上(D-2 留学签证原则上
// 不能从事营利性活动，见 mobile/README.md"广告变现"一节)。
//
// 真正上线时要做的事：
//   1. 确认签证/身份问题解决
//   2. 把 ADS_ENABLED 和 USE_TEST_ADS 都改成对应的值(ADS_ENABLED=true 打开整个功能，
//      USE_TEST_ADS=false 才会真正请求 PRODUCTION_BANNER_AD_UNIT_ID)
//   3. mobile/ios/App/App/Info.plist 里的 SKAdNetworkItems 换成 Google 文档当前的完整列表
//      (现在只放了 Google 自己那一条，够测试用，不够生产用)
//   4. frontend/privacy.html 补上 AdMob 披露(见 mobile/README.md"已知待办"第 3 条)，
//      App Store Connect 的 App Privacy 问卷同步更新，重新提审

const ADS_ENABLED = false;
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

// 广告变现——现在处于"走通技术流程"阶段，不是真正上线：ADS_ENABLED 打开了，但
// USE_TEST_ADS 也是 true，全程只用 Google 官方公开的测试 App ID / 测试广告位 ID
// (https://developers.google.com/admob/ios/test-ads)，不关联任何真实 AdMob 账号，
// 不会有真实广告展示，也不会产生任何真实收入。
//
// 之所以先这么接，是因为广告收入目前卡在用户的韩国签证问题上(D-2 留学签证原则上不能从事
// 营利性活动，见 mobile/README.md"广告变现"一节)，这个问题没解决之前不会真的上线广告；
// 但技术流程(SDK 接入、ATT 授权弹窗、原生 banner 展示)可以先走通、先熟悉。
//
// 真正上线时要做的事：
//   1. 确认签证/身份问题解决
//   2. 注册真实 AdMob 账号，创建真实 App + 广告单元，拿到真实 ID
//   3. 把 USE_TEST_ADS 改成 false，PRODUCTION_BANNER_AD_UNIT_ID 填真实值
//   4. mobile/ios/App/App/Info.plist 里的 GADApplicationIdentifier 换成真实 App ID，
//      SKAdNetworkItems 换成 Google 文档当前的完整列表(现在只放了 Google 自己那一条，
//      够测试用，不够生产用)
//   5. App Store Connect 的 App Privacy 问卷更新，声明用了广告/追踪 SDK，重新提审

const ADS_ENABLED = true;
const USE_TEST_ADS = true;

// Google 官方文档公开的测试专用 ID，任何开发者都能直接用，不需要注册真实 AdMob 账号：
// https://developers.google.com/admob/ios/test-ads
const TEST_BANNER_AD_UNIT_ID = "ca-app-pub-3940256099942544/2934735716";
const PRODUCTION_BANNER_AD_UNIT_ID = ""; // 还没申请，先留空

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

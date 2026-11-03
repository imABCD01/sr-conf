/*
 * sr-health v1.3 — Shadowrocket 内置链路自检（type=cron，每 10 分钟）
 * v1.2（2026-10-31）：新增「Rex 模块源 jsdelivr」链路——首页 15 模块/徽章/图标全在
 * cdn.jsdelivr.net（v3.7 已加 DIRECT 直连规则），用真实合集资源探测，兼验内容层。
 * v1.3（2026-11-03）：新增「TMDB 图片代理」链路——验证 CF Worker (imabcd.dpdns.org) 可用性，
 * 确保 URL Rewrite 重写后的海报请求能命中边缘缓存。
 * 通知策略（v1.1 降噪）：
 *   1) 同一异常需连续 2 轮（约 20 分钟）确认才通知——过滤瞬时抖动；
 *   2) 全部链路失败（网络级瘫痪）跳过确认立即通知；
 *   3) 同一签名 2 小时内不重复通知；每日最多 4 条；
 *   4) 恢复后补报一条「已恢复」。
 */
const TESTS = [
  { name: '代理链路', url: 'https://www.gstatic.com/generate_204' },
  { name: 'PikPak WebDAV', url: 'https://dav.pikpak.ai/' },
  { name: 'TestFlight', url: 'https://testflight.apple.com' },
  { name: 'PikPak API', url: 'https://www.mypikpak.com/' },
  { name: 'Rex模块源', url: 'https://cdn.jsdelivr.net/gh/imABCD01/rex-icons@main/all-modules6.rex' },
  { name: 'TMDB图片代理', url: 'https://imabcd.dpdns.org/__ping' }
];
const K_LAST_SIG = 'sr_h_last_sig';      // 上次已通知签名
const K_LAST_TS = 'sr_h_last_ts';        // 上次已通知时间
const K_STREAK_SIG = 'sr_h_streak_sig';  // 连续失败签名
const K_STREAK_N = 'sr_h_streak_n';      // 连续失败轮数
const K_PREV_FAIL = 'sr_h_prev_fail';    // 上一轮是否有未恢复异常
const K_DAY = 'sr_h_day';                // 当日日期
const K_DAY_N = 'sr_h_day_n';            // 当日已通知数

function runAll(done) {
  var results = [], pending = TESTS.length;
  TESTS.forEach(function (t) {
    var t0 = Date.now();
    $httpClient.get({ url: t.url, timeout: 8 }, function (err, resp) {
      var ms = Date.now() - t0;
      var status = 'ok';
      if (err || !resp || !resp.status) status = 'fail';
      else if (ms > 5000) status = 'slow';
      results.push({ name: t.name, status: status, ms: ms });
      if (--pending === 0) done(results);
    });
  });
}

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function main() {
  runAll(function (rs) {
    var ts = Date.now();
    var fails = rs.filter(function (r) { return r.status !== 'ok'; });

    /* 恢复分支 */
    if (fails.length === 0) {
      var prev = $persistentStore.read(K_PREV_FAIL);
      if (prev) {
        $notification.post('SR 网络自检', '✅ 已恢复', '此前异常：' + prev + '，当前全部链路正常');
        $persistentStore.write(K_PREV_FAIL, '');
      }
      $persistentStore.write(K_STREAK_N, '0');
      $done();
      return;
    }

    /* 连续失败计数（同签名累计，跨签名重置） */
    var sig = fails.map(function (f) { return f.name; }).join(',');
    var streakSig = $persistentStore.read(K_STREAK_SIG) || '';
    var n = parseInt($persistentStore.read(K_STREAK_N) || '0', 10);
    n = (sig === streakSig) ? n + 1 : 1;
    $persistentStore.write(K_STREAK_SIG, sig);
    $persistentStore.write(K_STREAK_N, String(n));

    /* 通知判定：全部失败跳过确认；部分失败需连续 2 轮 */
    var allDown = fails.length === TESTS.length;
    if (!allDown && n < 2) { $done(); return; }

    /* 去重 2 小时 + 每日 4 条 */
    if (sig === $persistentStore.read(K_LAST_SIG) &&
        ts - parseInt($persistentStore.read(K_LAST_TS) || '0', 10) < 2 * 60 * 60 * 1000) { $done(); return; }
    var today = todayStr();
    var cnt = ($persistentStore.read(K_DAY) === today) ? parseInt($persistentStore.read(K_DAY_N) || '0', 10) : 0;
    if (cnt >= 4) { $done(); return; }

    /* 发通知 */
    var detail = fails.map(function (f) {
      return f.name + (f.status === 'fail' ? '（连接失败）' : '（延迟 ' + f.ms + 'ms）');
    }).join('、');
    $notification.post('SR 网络自检', '⚠️ ' + fails.length + ' 条链路异常',
      detail + '。策略组将自动切换（≤2min）；持续异常请打开 Minis 分析。');
    $persistentStore.write(K_LAST_SIG, sig);
    $persistentStore.write(K_LAST_TS, String(ts));
    $persistentStore.write(K_PREV_FAIL, sig);
    $persistentStore.write(K_DAY, today);
    $persistentStore.write(K_DAY_N, String(cnt + 1));
    $done();
  });
}

main();
/*
 * sr-health v1 — Shadowrocket 内置链路自检（type=cron，每 10 分钟）
 * 特性：真实路由路径检测（请求按当前配置分流）；失败弹 iOS 通知（同签名 30 分钟去重）；
 *       恢复后补报一条「已恢复」；全程不依赖 Minis 是否打开。
 */
const TESTS = [
  { name: '代理链路', url: 'https://www.gstatic.com/generate_204' },
  { name: 'PikPak WebDAV', url: 'https://dav.pikpak.ai/' },
  { name: 'TestFlight', url: 'https://testflight.apple.com' },
  { name: 'PikPak API', url: 'https://www.mypikpak.com/' }
];
const K_LAST_SIG = 'sr_health_last_sig';
const K_LAST_TS = 'sr_health_last_ts';
const K_PREV_FAIL = 'sr_health_prev_fail';

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

function main() {
  runAll(function (rs) {
    var fails = rs.filter(function (r) { return r.status !== 'ok'; });
    var ts = Date.now();
    if (fails.length === 0) {
      var prev = $persistentStore.read(K_PREV_FAIL);
      if (prev) {
        $notification.post('SR 网络自检', '✅ 已恢复', '此前异常：' + prev + '，当前全部链路正常');
        $persistentStore.write(K_PREV_FAIL, '');
      }
      $done();
      return;
    }
    var sig = fails.map(function (f) { return f.name; }).join(',');
    var lastTs = parseInt($persistentStore.read(K_LAST_TS) || '0', 10);
    if (sig === $persistentStore.read(K_LAST_SIG) && ts - lastTs < 30 * 60 * 1000) { $done(); return; }
    $persistentStore.write(K_LAST_SIG, sig);
    $persistentStore.write(K_LAST_TS, String(ts));
    $persistentStore.write(K_PREV_FAIL, sig);
    var detail = fails.map(function (f) {
      return f.name + (f.status === 'fail' ? '（连接失败）' : '（延迟 ' + f.ms + 'ms）');
    }).join('、');
    $notification.post('SR 网络自检', '⚠️ ' + fails.length + ' 条链路异常', detail + '。策略组将自动切换（≤2min）；持续异常请打开 Minis 分析。');
    $done();
  });
}

main();

/**
 * react-native-kline-chart / react-native-graph 仍用 Skia 2.x 已弃用的
 * SkPath.moveTo/lineTo/addRect，会在 DEV 刷屏。
 * 本脚本在 npm install 后把源码切到 PathBuilder（幂等）。
 */
const fs = require('fs');
const path = require('path');

function replaceInFile(file, pairs) {
  if (!fs.existsSync(file)) return false;
  let t = fs.readFileSync(file, 'utf8');
  const before = t;
  for (const [from, to] of pairs) {
    t = t.split(from).join(to);
  }
  if (t !== before) {
    fs.writeFileSync(file, t);
    console.log('[patch-skia-path] patched', path.relative(process.cwd(), file));
    return true;
  }
  return false;
}

const root = process.cwd();

replaceInFile(path.join(root, 'node_modules/react-native-kline-chart/src/drawing/drawMA.ts'), [
  ['const path = Skia.Path.Make();', 'const builder = Skia.PathBuilder.Make();'],
  ['path.moveTo(', 'builder.moveTo('],
  ['path.lineTo(', 'builder.lineTo('],
  ['canvas.drawPath(path, paint);', 'canvas.drawPath(builder.detach(), paint);'],
]);

replaceInFile(path.join(root, 'node_modules/react-native-kline-chart/src/KlineChart.tsx'), [
  ['const bullPath = Skia.Path.Make();', 'const bullPath = Skia.PathBuilder.Make();'],
  ['const bearPath = Skia.Path.Make();', 'const bearPath = Skia.PathBuilder.Make();'],
  ['const bullWickPath = Skia.Path.Make();', 'const bullWickPath = Skia.PathBuilder.Make();'],
  ['const bearWickPath = Skia.Path.Make();', 'const bearWickPath = Skia.PathBuilder.Make();'],
  ['const path = Skia.Path.Make();', 'const builder = Skia.PathBuilder.Make();'],
  ['path.moveTo(', 'builder.moveTo('],
  ['path.lineTo(', 'builder.lineTo('],
  ['canvas.drawPath(path, maPaint);', 'canvas.drawPath(builder.detach(), maPaint);'],
  ['canvas.drawPath(bullWickPath,', 'canvas.drawPath(bullWickPath.detach(),'],
  ['canvas.drawPath(bearWickPath,', 'canvas.drawPath(bearWickPath.detach(),'],
  ['canvas.drawPath(bullPath,', 'canvas.drawPath(bullPath.detach(),'],
  ['canvas.drawPath(bearPath,', 'canvas.drawPath(bearPath.detach(),'],
]);

replaceInFile(path.join(root, 'node_modules/react-native-graph/src/CreateGraphPath.ts'), [
  ['const path = Skia.Path.Make();', 'const builder = Skia.PathBuilder.Make();'],
  ['path.moveTo(', 'builder.moveTo('],
  ['path.lineTo(', 'builder.lineTo('],
]);

replaceInFile(path.join(root, 'node_modules/react-native-graph/src/AnimatedLineGraph.tsx'), [
  ['const path = Skia.Path.Make();', 'const builder = Skia.PathBuilder.Make();'],
  ['path.moveTo(', 'builder.moveTo('],
  ['path.lineTo(', 'builder.lineTo('],
]);

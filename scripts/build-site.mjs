// 把网页文件和采集到的数据合成一个可以直接发布的网站目录
// 用法：node scripts/build-site.mjs <数据目录> <输出目录>
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const [stateDir = 'state', out = '_site'] = process.argv.slice(2);
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'data'), { recursive: true });
await cp('web', out, { recursive: true });
for (const name of ['repos.json', 'meta.json', 'trending.json', 'changes.json', 'history']) {
  await cp(join(stateDir, name), join(out, 'data', name), { recursive: true });
}
console.log('网站已生成：' + out + '（数据文件 ' + (await readdir(join(out, 'data', 'history'))).length + ' 个分片）');

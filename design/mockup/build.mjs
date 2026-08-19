// tpl.html + mockdata.json + 서브셋 폰트 -> desk.html (자기완결 단일 파일)
// 실행: node design/mockup/build.mjs   (리포 루트에서)
import fs from 'fs';
const dir='design/mockup';
const tpl=fs.readFileSync(`${dir}/tpl.html`,'utf8');
const data=fs.readFileSync(`${dir}/mockdata.json`,'utf8').replace(/<\//g,'<\/');
const font=fs.readFileSync(`${dir}/Pretendard.subset.woff2`).toString('base64');
fs.writeFileSync(`${dir}/desk.html`, tpl.replace('__FONT__',font).replace('__DATA__',data));
console.log('desk.html', (fs.statSync(`${dir}/desk.html`).size/1024).toFixed(0)+'KB');

// index.html의 로컬 js/css 링크에 버전 쿼리(?v=...)를 붙여 브라우저 캐시 무효화
const fs = require('fs');
const [, , file, ver] = process.argv;
let s = fs.readFileSync(file, 'utf8');
s = s.replace(/((?:src|href)="(?:js|css)\/[^"?]+\.(?:js|css))(\?v=[^"]*)?"/g, `$1?v=${ver}"`);
fs.writeFileSync(file, s);
console.log((s.match(/\?v=/g) || []).length + ' links versioned');

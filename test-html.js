import fs from 'fs';
const css = fs.readFileSync('src/app/globals.css', 'utf-8');
const newCss = css + "\n#zohohc-asap-web-button { display: none !important; }\n";
fs.writeFileSync('src/app/globals.css', newCss);

const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src');
let changedFiles = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;
  
  // Replace <button className="... w-10 h-10 ..."> with w-11 h-11
  content = content.replace(/<button([^>]*className="[^"]*)w-10 h-10([^"]*")/g, '<button$1w-11 h-11$2');
  content = content.replace(/<button([^>]*className="[^"]*)w-8 h-8([^"]*")/g, '<button$1min-w-[44px] min-h-[44px] p-2$2');
  content = content.replace(/<button([^>]*className="[^"]*)w-6 h-6([^"]*")/g, '<button$1w-11 h-11 p-2.5$2');
  
  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    changedFiles++;
  }
});

console.log(`Updated buttons in ${changedFiles} files.`);

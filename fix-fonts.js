const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file);
    }
  });
  return results;
}

const files = walk('./src/components').concat(walk('./src/app'));

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('Pacifico')) {
    // FONT_RALEWAY
    content = content.replace(/const FONT_RALEWAY = ['"]?\\?"Pacifico\\?", cursive['"]?;/g, 'const FONT_RALEWAY = "var(--font-raleway)";');
    // FONT_PACIFICO (usually headers, we'll use jersey25)
    content = content.replace(/const FONT_PACIFICO = ['"]?\\?"Pacifico\\?", cursive['"]?;/g, 'const FONT_PACIFICO = "var(--font-jersey25)";');
    content = content.replace(/const FONT_PACIFICO = 'Pacifico, cursive';/g, 'const FONT_PACIFICO = "var(--font-jersey25)";');
    content = content.replace(/const PACIFICO = "Pacifico, cursive";/g, 'const PACIFICO = "var(--font-jersey25)";');
    
    // other const FONT = ...
    content = content.replace(/const FONT = ['"]?\\?"Pacifico\\?", cursive['"]?;/g, 'const FONT = "var(--font-work-sans)";');
    content = content.replace(/const RALEWAY = ['"]?\\?"Pacifico\\?", cursive['"]?;/g, 'const RALEWAY = "var(--font-raleway)";');
    content = content.replace(/const JAKARTA = ['"]?\\?"Pacifico\\?", cursive['"]?;/g, 'const JAKARTA = "var(--font-work-sans)";');
    content = content.replace(/const FONT_RL\s*=\s*['"]?\\?"Pacifico\\?", cursive['"]?;/g, 'const FONT_RL = "var(--font-raleway)";');

    // Inline styles with specific tags
    // h1, h2, h3 -> Jersey 25
    content = content.replace(/<h[123][^>]*style={{[^}]*fontFamily:\s*['"]\\?"Pacifico\\?",\s*cursive['"][^}]*}}/g, match => {
        return match.replace(/['"]\\?"Pacifico\\?",\s*cursive['"]/, '"var(--font-jersey25)"');
    });
    content = content.replace(/<h[123][^>]*style={{[^}]*fontFamily:\s*['"]Pacifico,\s*cursive['"][^}]*}}/g, match => {
        return match.replace(/['"]Pacifico,\s*cursive['"]/, '"var(--font-jersey25)"');
    });

    // p, span, div -> Work Sans
    content = content.replace(/fontFamily:\s*['"]\\?"Pacifico\\?",\s*cursive['"]/g, 'fontFamily: "var(--font-work-sans)"');
    content = content.replace(/fontFamily:\s*['"]Pacifico,\s*cursive['"]/g, 'fontFamily: "var(--font-work-sans)"');
    
    fs.writeFileSync(file, content, 'utf8');
  }
});
console.log("Done");

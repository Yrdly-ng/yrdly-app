import os
import re

directories = ['src/components', 'src/app']

regexes = [
    (re.compile(r'rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.\d+\s*\)'), 'var(--c-border)'),
]

for directory in directories:
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.tsx'):
                path = os.path.join(root, file)
                with open(path, 'r') as f:
                    content = f.read()
                
                new_content = content
                
                # Careful: rgba(255,255,255,0.05) is often used as background too.
                # If we replace all rgba(255...) with var(--c-border), it might break backgrounds.
                # Let's only replace if it's used in border: or borderTop: etc.
                
                # We'll use a safer regex for borders:
                # e.g. border: "1px solid rgba(255,255,255,0.08)" -> border: "1px solid var(--c-border)"
                new_content = re.sub(
                    r'(border|borderTop|borderBottom|borderLeft|borderRight|borderColor|boxShadow):\s*(?P<q>["\']).*?rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.\d+\s*\).*?(?P=q)',
                    lambda m: m.group(0).replace(re.search(r'rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.\d+\s*\)', m.group(0)).group(0), 'var(--c-border)'),
                    new_content
                )
                
                if new_content != content:
                    with open(path, 'w') as f:
                        f.write(new_content)
                    print(f'Updated {path}')

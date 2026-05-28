import os
import re

files = [
    'src/components/NotificationsScreen.tsx',
    'src/components/ProfileScreen.tsx',
    'src/components/ConversationScreen.tsx',
    'src/components/SettingsScreen.tsx',
    'src/components/ProfileDropdown.tsx'
]

replacements = [
    (r'"0.5px solid rgba\(255,255,255,0.06\)"', '"0.5px solid var(--c-border)"'),
    (r'style=\{\{\s*background:\s*"rgba\(255,255,255,0.1\)",\s*color:\s*"#fff",\s*border:\s*0\s*\}\}', 
     'style={{ background: "var(--c-card)", border: "1px solid var(--c-border)", color: "var(--c-text)" }}'),
    (r'onMouseEnter=\{\(e\)\s*=>\s*\(\(e.currentTarget\s*as\s*HTMLElement\).style.background\s*=\s*"rgba\(255,255,255,0.1\)"\)\}', 
     'onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.8")}'),
    (r'onMouseEnter=\{\(e\)\s*=>\s*\(\(e.currentTarget\s*as\s*HTMLElement\).style.background\s*=\s*"rgba\(255,255,255,0.05\)"\)\}', 
     'onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.8")}'),
    (r'"rgba\(255,255,255,0.05\)"\)', '"transparent")'), # For ProfileDropdown/SettingsScreen
]

for filepath in files:
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            content = f.read()
        
        new_content = content
        for search, replace in replacements:
            new_content = re.sub(search, replace, new_content)
        
        if new_content != content:
            with open(filepath, 'w') as f:
                f.write(new_content)
            print(f'Updated {filepath}')

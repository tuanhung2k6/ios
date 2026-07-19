import io
import base64
import os

def get_base64_of_file(filepath):
    if not os.path.exists(filepath):
        # Fallback search
        alt_path = os.path.basename(filepath)
        if os.path.exists(alt_path):
            filepath = alt_path
    with io.open(filepath, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

print("[+] Compiling web dashboard assets into Swift...")

index_b64 = get_base64_of_file('web_server_dashboard/public/index.html')
style_b64 = get_base64_of_file('web_server_dashboard/public/style.css')
app_b64 = get_base64_of_file('web_server_dashboard/public/app.js')

# VNC Helper fallback path
vnc_path = 'C:/Users/nguye/Downloads/Upvideo/ioscontrol_repo/ioscontrol_custom_project/static/vnc_helper.html'
if not os.path.exists(vnc_path):
    vnc_path = 'web_server_dashboard/public/vnc_helper.html'
    # If it doesn't exist, generate a basic default one
    if not os.path.exists(vnc_path):
        default_vnc = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>VNC Helper</title>
<style>
  * { margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  #screen { width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
<div id="screen"></div>
<script type="module">
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host') || window.location.hostname;
  const port = params.get('port') || '5900';
  const vncPort = params.get('vnc_http') || '5902';
  const script = document.createElement('script');
  script.type = 'module';
  script.textContent = `
    import RFB from 'http://${host}:${vncPort}/novnc/core/rfb.js';
    const screenEl = document.getElementById('screen');
    const rfb = new RFB(screenEl, 'ws://${host}:${port}', { wsProtocols: ['binary'] });
    rfb.viewOnly = true;
    rfb.scaleViewport = true;
    rfb.background = '#000000';
    rfb.addEventListener('connect', () => { setTimeout(() => rfb.scaleViewport = true, 500); });
    rfb.addEventListener('disconnect', () => { setTimeout(() => window.location.reload(), 3000); });
    window.addEventListener('resize', () => { rfb.scaleViewport = true; });
  `;
  document.body.appendChild(script);
</script>
</body>
</html>"""
        with io.open(vnc_path, 'w', encoding='utf-8') as f:
            f.write(default_vnc)

vnc_b64 = get_base64_of_file(vnc_path)

swift_content = f"""import Foundation

struct WebAssets {{
    static let indexHtmlBase64 = "{index_b64}"
    static let styleCssBase64 = "{style_b64}"
    static let appJsBase64 = "{app_b64}"
    static let vncHelperBase64 = "{vnc_b64}"
    
    static let indexHtmlData: Data = Data(base64Encoded: indexHtmlBase64) ?? Data()
    static let styleCssData: Data = Data(base64Encoded: styleCssBase64) ?? Data()
    static let appJsData: Data = Data(base64Encoded: appJsBase64) ?? Data()
    static let vncHelperData: Data = Data(base64Encoded: vncHelperBase64) ?? Data()
}}
"""

out_path = 'ios_client_app/iControlApp/WebAssets.swift'
with io.open(out_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(swift_content)

print(f"[+] Successfully generated WebAssets.swift at {out_path}")

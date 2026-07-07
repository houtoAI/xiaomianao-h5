import subprocess
import os
import sys

os.environ['JAVA_HOME'] = r'L:\TRAE项目\jdk17'
os.environ['PATH'] = os.environ['JAVA_HOME'] + r'\bin;' + os.environ['PATH']
os.environ['ANDROID_SDK_ROOT'] = r'L:\TRAE项目\android-sdk'

sdkmanager = r'L:\TRAE项目\android-sdk\cmdline-tools\latest\bin\sdkmanager.bat'

packages = [
    'platform-tools',
    'platforms;android-34',
    'build-tools;34.0.0',
    'system-images;android-34;google_apis;x86_64',
    'emulator',
]

print("Installing SDK components...")
print("This may take 5-10 minutes...")

proc = subprocess.Popen(
    [sdkmanager, '--sdk_root=L:\\TRAE项目\\android-sdk'] + packages,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)

output_bytes, _ = proc.communicate(input=b'y\r\n' * 50)
try:
    output = output_bytes.decode('utf-8', errors='ignore')
except:
    output = output_bytes.decode('gbk', errors='ignore')

print(output[-2000:] if len(output) > 2000 else output)
print("Done. Return code:", proc.returncode)

import subprocess
import os
import sys

os.environ['JAVA_HOME'] = r'L:\TRAE项目\jdk17'
os.environ['PATH'] = os.environ['JAVA_HOME'] + r'\bin;' + os.environ['PATH']
os.environ['ANDROID_SDK_ROOT'] = r'L:\TRAE项目\android-sdk'

sdkmanager = r'L:\TRAE项目\android-sdk\cmdline-tools\latest\bin\sdkmanager.bat'

print("Accepting licenses...")
proc = subprocess.Popen(
    [sdkmanager, '--sdk_root=L:\\TRAE项目\\android-sdk', '--licenses'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)

output_bytes, _ = proc.communicate(input=b'y\r\n' * 100)
try:
    output = output_bytes.decode('utf-8', errors='ignore')
except:
    output = output_bytes.decode('gbk', errors='ignore')

print(output[-1000:] if len(output) > 1000 else output)
print("Done. Return code:", proc.returncode)

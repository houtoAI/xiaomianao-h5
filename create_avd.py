import subprocess
import os

os.environ['JAVA_HOME'] = r'L:\TRAE项目\jdk17'
os.environ['PATH'] = os.environ['JAVA_HOME'] + r'\bin;' + os.environ['PATH']
os.environ['ANDROID_SDK_ROOT'] = r'L:\TRAE项目\android-sdk'
os.environ['ANDROID_HOME'] = r'L:\TRAE项目\android-sdk'

avdmanager = r'L:\TRAE项目\android-sdk\cmdline-tools\latest\bin\avdmanager.bat'

print("Creating AVD...")
proc = subprocess.Popen(
    [avdmanager, 'create', 'avd', '-n', 'XiaoMianAo', '-k', 'system-images;android-34;google_apis;x86_64', '-d', 'pixel_5', '--force'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)

output_bytes, _ = proc.communicate(input=b'\r\n')
try:
    output = output_bytes.decode('utf-8', errors='ignore')
except:
    output = output_bytes.decode('gbk', errors='ignore')

print(output)
print("Done. Return code:", proc.returncode)

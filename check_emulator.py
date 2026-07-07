import subprocess
import os
import time

os.environ['ANDROID_SDK_ROOT'] = r'L:\TRAE项目\android-sdk'
os.environ['ANDROID_HOME'] = r'L:\TRAE项目\android-sdk'
os.environ['JAVA_HOME'] = r'L:\TRAE项目\jdk17'

emulator = r'L:\TRAE项目\android-sdk\emulator\emulator.exe'

print("Checking emulator version...")
result = subprocess.run([emulator, '-version'], capture_output=True, text=True)
print(result.stdout[:500])
print(result.stderr[:500])

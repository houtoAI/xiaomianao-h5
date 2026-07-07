import subprocess
import os
import time

os.environ['ANDROID_SDK_ROOT'] = r'L:\TRAE项目\android-sdk'
os.environ['ANDROID_HOME'] = r'L:\TRAE项目\android-sdk'
os.environ['JAVA_HOME'] = r'L:\TRAE项目\jdk17'

emulator = r'L:\TRAE项目\android-sdk\emulator\emulator.exe'

print("Starting emulator with verbose output...")
proc = subprocess.Popen(
    [emulator, '-avd', 'XiaoMianAo', '-no-snapshot-load', '-no-boot-anim', '-verbose'],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
)

time.sleep(10)
if proc.poll() is not None:
    output = proc.stdout.read().decode('utf-8', errors='ignore')
    print("Emulator exited with code:", proc.returncode)
    print(output[-3000:])
else:
    print("Emulator is running (PID:", proc.pid, ")")
    proc.terminate()

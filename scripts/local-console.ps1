param([ValidateSet('frontend','backend')][string]$Role)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
# A non-inherited handle owned by this console process kills only its job on exit.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint count; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int info,ref Extended value,uint length);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 static IntPtr job;
 public static void Attach() {
  job=CreateJobObject(IntPtr.Zero,null);
  var limits=new Extended(); limits.basic.flags=0x2000;
  if(job==IntPtr.Zero || !SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))) || !AssignProcessToJobObject(job,GetCurrentProcess())) throw new Exception("CONSOLE_JOB_SETUP_FAILED");
 }
}
"@
[ConsoleJob]::Attach()
$rootKey = (Get-Location).Path.ToLowerInvariant()
$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($rootKey))).Replace('-','').Substring(0,20)
$instance = [Threading.Mutex]::new($false, "Local\runad123-$hash-$Role")
$owned = $false
try {
 try { $owned = $instance.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
 if (!$owned) { Write-Host "$Role is already running. Use its existing window."; exit 1 }
 $build = [Threading.Mutex]::new($false, "Local\runad123-$hash-build")
 $buildOwned = $false
 try {
  Write-Host 'Waiting for build lock...'
  try { $buildOwned = $build.WaitOne() } catch [Threading.AbandonedMutexException] { $buildOwned = $true }
  & node scripts/local-console.mjs $Role prepare
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
 } finally { if ($buildOwned) { $build.ReleaseMutex() }; $build.Dispose() }
 & node scripts/local-console.mjs $Role run
 exit $LASTEXITCODE
} finally { if ($owned) { $instance.ReleaseMutex() }; $instance.Dispose() }

#!/usr/bin/env node
// Builds the Android app and leaves it where the bridge serves it:
// bridge/pastor.apk, with bridge/pastor.apk.json (its version) for the
// app's own update check. Needs JDK 21 (PASTOR_JDK, or ~/.claude/pastor/tools/jdk-21*)
// and the Android SDK (ANDROID_HOME).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'app')
const win = process.platform === 'win32'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: win, ...opts })

const tools = path.join(os.homedir(), '.claude', 'pastor', 'tools')
const jdk = process.env.PASTOR_JDK || (fs.existsSync(tools) && fs.readdirSync(tools).filter(d => d.startsWith('jdk-21')).map(d => path.join(tools, d))[0])
if (!jdk) { console.error('Falta un JDK 21: PASTOR_JDK o ~/.claude/pastor/tools/jdk-21*'); process.exit(1) }
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
if (!sdk) { console.error('Falta ANDROID_HOME (el SDK de Android)'); process.exit(1) }

run('npm', ['run', 'build'], { cwd: APP })
run('npx', ['cap', 'sync', 'android'], { cwd: APP })
run(path.join(APP, 'android', win ? 'gradlew.bat' : 'gradlew'), ['assembleDebug', '--no-daemon', '-q'], { cwd: path.join(APP, 'android'), env: { ...process.env, JAVA_HOME: jdk } })

const apk = path.join(APP, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const out = path.join(ROOT, 'bridge', 'pastor.apk')
fs.copyFileSync(apk, out)
const tools35 = fs.readdirSync(path.join(sdk, 'build-tools')).sort().pop()
const badging = execFileSync(path.join(sdk, 'build-tools', tools35, win ? 'aapt.exe' : 'aapt'), ['dump', 'badging', out]).toString()
const m = badging.match(/versionCode='(\d+)' versionName='([^']*)'/)
const info = { versionCode: Number(m?.[1] ?? 0), versionName: m?.[2] ?? '', size: fs.statSync(out).size, builtAt: new Date().toISOString() }
fs.writeFileSync(path.join(ROOT, 'bridge', 'pastor.apk.json'), JSON.stringify(info, null, 2))
console.log(`pastor.apk ${info.versionName} (${info.versionCode}) · ${(info.size / 1048576).toFixed(1)} MB`)

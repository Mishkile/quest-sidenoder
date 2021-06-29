const exec = require('child_process').exec;
const adb = require('adbkit')
const client = adb.createClient();
const fs = require('fs');
const fsExtra = require('fs-extra');
const fsPromise = fs.promises;
const platform = require('os').platform();


const fetch = require('node-fetch');
const path = require('path');
const commandExists = require('command-exists');
const util = require('util');
const ApkReader = require('node-apk-parser');

const fixPath = require('fix-path');
fixPath();

const configLocation = require('path').join(homedir, 'sidenoder-config.json');

console.log({platform});
if (!['win64', 'win32'].includes(platform)) {
  global.nullcmd = '> /dev/null'
  global.nullerror = '2> /dev/null'
}
else {
  global.nullcmd = '> null'
  global.nullerror = '2> null'
}

let QUEST_ICONS = [];
fetch('https://raw.githubusercontent.com/vKolerts/quest_icons/master/list.json')
.then(res => res.json()) // expecting a json response
.then(json => QUEST_ICONS = json)
.catch(err => {
  console.error('can`t get quest_icons', err);
})


module.exports =
{
  getDeviceSync,
  trackDevices,
  checkDeps,
  checkMount,
  mount,
  getDir,
  returnError,
  sideloadFolder,
  checkUpdateAvailable,
  getInstalledApps,
  getInstalledAppsWithUpdates,
  getApkFromFolder,
  uninstall,
  getDirListing,
  getPackageInfo,
  connectWireless,
  disconnectWireless,
  getActivities,
  startActivity,
  getDeviceInfo,
  getStorageInfo,
  getUserInfo,
  getFwInfo,
  getBatteryInfo,
  changeConfig,
  reloadConfig,
  execShellCommand,
  updateRcloneProgress,
  // ...
}

async function getDeviceInfo() {
  console.log('getDeviceInfo()');

  const storage = await getStorageInfo();
  const user = await getUserInfo();
  const fw = await getFwInfo();
  const battery = await getBatteryInfo();

  const res = {
    success: !!storage,
    storage,
    user,
    fw,
    battery,
  };

  console.log('getDeviceInfo', res);
  return res;
}

async function getFwInfo() {
  console.log('getFwInfo()');
  const res = await execShellCommand('adb shell "getprop ro.build.branch"');
  if (!res) return false;

  return {
    version: res.replace('releases-oculus-', '').replace('\n', ''),
  }
}

async function getBatteryInfo() {
  console.log('getBatteryInfo()');
  const res = await execShellCommand('adb shell "dumpsys battery | grep level"');
  if (!res) return false;

  return {
    level: res.slice(9).replace('\n', ''),
  }
}

async function getUserInfo() {
  console.log('getUserInfo()');
  const res = await execShellCommand('adb shell "dumpsys user | grep UserInfo"');
  if (!res) return false;

  return {
    name: res.split(':')[1],
  }
}

async function getStorageInfo() {
  console.log('getStorageInfo()');

  const res = await execShellCommand('adb shell "df -h"');
  const re = new RegExp('.*/storage/emulated.*');
  if (!res) return false;

  const linematch = res.match(re);
  if (!linematch) return false;

  const refree = new RegExp('([0-9(.{1})]+[a-zA-Z%])', 'g');
  const storage = linematch[0].match(refree);

  if (storage.length == 3) {
    return {
      size: storage[0],
      used: storage[1],
      free: 0,
      percent: storage[2],
    };
  }

  return {
    size: storage[0],
    used: storage[1],
    free: storage[2],
    percent: storage[3],
  };
}

async function getActivities(package, activity = false) {
  console.log('getActivities()', package);

  let activities = await execShellCommand(`adb shell "dumpsys package | grep -Eo '^[[:space:]]+[0-9a-f]+[[:space:]]+${package}/[^[:space:]]+' | grep -oE '[^[:space:]]+$'"`);
  if (!activities) return false;

  activities = activities.split('\n');
  activities.pop();
  console.log({ package, activities });

  return activities;
}

async function startActivity(activity) {
  console.log('startActivity()', activity);
  const result = await execShellCommand(`adb shell "am start ${activity}"`); // TODO activity selection

  console.log('startActivity', activity, result);
  return result;
}

async function checkUpdateAvailable() {
  console.log('Checking local version vs latest github version')
  remotehead = await execShellCommand('git ls-remote origin HEAD')
  await execShellCommand('git fetch')
  localhead = await execShellCommand('git rev-parse HEAD')
  //console.log(`remotehead: ${remotehead}|`)
  //console.log(`localhead: ${localhead}|`)

  if (remotehead.startsWith(localhead.replace(/(\r\n|\n|\r)/gm,""))) {
    global.updateAvailable = false;
    return false;
  }
  else {
    console.log('')
    console.log('A update is available, please pull the latest version from github!')
    console.log('')
    global.updateAvailable = true;
    return true;
  }
}
// Implementation ----------------------------------

async function getDeviceIp() {
  let ip = await execShellCommand(`adb shell "ip -o route get to 8.8.8.8 | sed -n 's/.*src \\([0-9.]\\+\\).*/\\1/p'"`);
  if (ip) return ip;

  return execShellCommand(`adb shell "ip addr show wlan0  | grep 'inet ' | cut -d ' ' -f 6 | cut -d / -f 1"`);
}

async function connectWireless() {
  // await execShellCommand(`adb shell "setprop service.adb.tcp.port 5555"`);
  const ip = await getDeviceIp();
  if (!ip) return false;

  await execShellCommand(`adb tcpip 5555`);
  const res = await execShellCommand(`adb connect ${ip}:5555`);
  console.log('connectWireless', { ip, res });
  return ip;
}

async function disconnectWireless() {
  const ip = await getDeviceIp();
  if (!ip) return false;

  const res = await execShellCommand(`adb disconnect ${ip}:5555`);
  console.log('disconnectWireless', { ip, res });
  return res;
}

function getDeviceSync() {
  client.listDevices()
  .then((devices) => {
    console.log('getDevice()', devices)
    if (devices.length > 0) {
      global.adbDevice = devices[0].id;
      win.webContents.send('check_device', {success: devices[0].id });
    }
    else {
      global.adbDevice = false;
      win.webContents.send('check_device', { success: false });
    }
  })
  .catch((err) => {
    console.error('Something went wrong:', err.stack)
  });
}


/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execShellCommand(cmd, buffer = 5000) {
  console.log({cmd});
  return new Promise((resolve, reject) => {
    exec(cmd,  {maxBuffer: 1024 * buffer}, (error, stdout, stderr) => {
      if (error) {
        console.error('exec_error', error);
        global.adbError = error;
        // return resolve(error);
      }

      if (stdout) {
        console.log('exec_stdout', stdout);
        global.adbError = null;
        return resolve(stdout);
      }
      else {
        console.error('exec_stderr', stderr);
        global.adbError = stderr;
        return resolve(false);
      }
    });
  });
}


function trackDevices(){
  console.log('trackDevices()')
  client.trackDevices()
  .then((tracker) => {
    tracker.on('add', function(device) {
      win.webContents.send('check_device', { success: device.id });
      global.adbDevice = device.id;
      console.log('Device %s was plugged in', { success: device.id });
    })
    tracker.on('remove', function(device) {
      global.adbDevice = false;
      resp = {success: global.adbDevice}
      win.webContents.send('check_device', resp);
      console.log('Device %s was unplugged', resp);
      getDeviceSync();
      trackDevices();
    })
    tracker.on('end', function() {
      console.log('Tracking stopped')
    });
  })
  .catch(function(err) {
    console.error('Something went wrong:', err.stack)
  })
}

/*async function checkMount(){
  console.log('checkMount()')
  try {
    await fsPromise.readdir(global.mountFolder);
    list = await getDir(global.mountFolder);
    if (list.length > 0) {
      global.mounted = true
      updateRcloneProgress();
      return true
    }
    global.mounted = false
    return false;
  }
  catch (e) {
    console.log('entering catch block');
    console.log(e);
    console.log('leaving catch block');
    global.mounted = false
    return false
  }

  return false;
}*/

async function checkMount() {
  console.log('checkMount()')
  try {
    const resp = await fetch('http://127.0.0.1:5572/rc/noop', {
      method: 'post',
    });
    global.mounted = resp.ok;
    return resp.ok;
    //setTimeout(updateRcloneProgress, 2000);
  }
  catch (e) {
    global.mounted = false;
    return false;
  }
}

async function checkDeps(){
  console.log('checkDeps()')
  try {
    exists = await commandExists('adb');
  }
  catch (e) {
    returnError('ADB global installation not found, please read the <a href="https://github.com/vKolerts/quest-sidenoder#running-the-compiled-version">README on github</a>.')
    return;
  }

  try {
    exists = await commandExists('rclone');
  }
  catch (e) {
    returnError('RCLONE global installation not found, please read the <a href="https://github.com/vKolerts/quest-sidenoder#running-the-compiled-version">README on github</a>.')
    return;
  }
  //wtf werkt nie
  //win.webContents.send('check_deps',{ success: true });
  return;
}

function returnError(message){
  console.log('returnError()')
  global.win.loadURL(`file://${__dirname}/views/error.twig`)
  twig.view = {
    message: message,
  }
}


async function killRClone(){
  const killCmd = (['win64', 'win32'].includes(platform))
    ? `taskkill.exe /F /IM rclone.exe /T` // TODO: need test
    : `killall -9 rclone`;
  console.log('try kill rclone');
  return new Promise((res, rej) => {
    exec(killCmd, (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`, error);
        return rej(error);
      }

      if (stderr) {
        console.log('stderr:', stderr);
        return rej(stderr);
      }

      console.log('stdout:', stdout);
      return res(stdout);
    });
  })
}


async function mount(){
  if (await checkMount(global.mountFolder)) {
    // return;
    await killRClone();
  }

  if (!['win64', 'win32'].includes(platform)) {
    await execShellCommand(`umount ${global.mountFolder} ${global.nullerror}`);
    await execShellCommand(`fusermount -uz ${global.mountFolder} ${global.nullerror}`);
    await fs.mkdir(global.mountFolder, {}, ()=>{}) // folder must exist on windows
  }
  else {
    await execShellCommand(`rmdir "${global.mountFolder}" ${global.nullerror}`); // folder must NOT exist on windows
  }

  const epath = require('path').join(__dirname , 'a.enc'); // 'a'
  const cpath = require('path').join(global.tmpdir, 'sidenoder_a');
  const data = fs.readFileSync(epath, 'utf-8');
  const buff = Buffer.from(data, 'base64');
  const cfg = buff.toString('ascii');
  fs.writeFileSync(cpath, cfg);

  // const buff = new Buffer(data);
  // const base64data = buff.toString('base64');
  // fs.writeFileSync(epath + '.enc', base64data);
  //console.log(cpath);

  const mountCmd = (platform == 'darwin') ? 'cmount' : 'mount';
  console.log('start rclone');
  exec(`rclone ${mountCmd} --read-only --rc --rc-no-auth --config=${cpath} ${global.currentConfiguration.cfgSection}: ${global.mountFolder}`, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      if (error.message.search('transport endpoint is not connected')) {
        console.log('GEVONDE')
      }
      return;
    }

    if (stderr) {
      console.log('stderr:', stderr);
      return;
    }

    console.log('stdout:', stdout);
  });
}


async function getDir(folder) {
  try {
    const files = await fsPromise.readdir(folder/*, { withFileTypes: true }*/);
    let gameList = {};
    try {
      if (files.includes('GameList.txt')) {
        const list = fs.readFileSync(path.join(folder, 'GameList.txt'), 'utf8').split('\n');
        for (const line of list) {
          const meta = line.split(';');
          gameList[meta[1]] = {
            simpleName: meta[0],
            packageName: meta[3],
            versionCode: meta[4],
            versionName: meta[5],
            imagePath: `file://${global.tmpdir}/mnt/Quest Games/.meta/thumbnails/${meta[3]}.jpg`,
          }
        }
      }
    }
    catch (err) {
      console.error('GameList.txt failed', err);
    }

    let fileNames = await Promise.all(files.map(async (fileName) => {
      const info = await fsPromise.lstat(path.join(folder, fileName));
      let steamId = false,
        oculusId = false,
        imagePath = false,
        versionCode = 'PROCESSING',
        infoLink = false,
        simpleName = fileName,
        packageName = false,
        mp = false;

      const gameMeta = gameList[fileName];
      if (gameMeta) {
        simpleName = gameMeta.simpleName;
        packageName = gameMeta.packageName;
        versionCode = gameMeta.versionCode;
        simpleName = gameMeta.simpleName;
        // imagePath = gameMeta.imagePath;
      }

      if ((new RegExp('.*\ -steam-')).test(fileName)) {
        //steamId = fileEnt.name.split('steam-')[1]
        steamId = fileName.match(/-steam-([0-9]*)/)[1]
        simpleName = simpleName.split(' -steam-')[0]
        imagePath = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + steamId + '/header.jpg'
        infoLink = 'https://store.steampowered.com/app/' + steamId + '/'
      }

      if ((new RegExp(".*\ -oculus-")).test(fileName)) {
        //oculusId = fileEnt.name.split('oculus-')[1]
        oculusId = fileName.match(/-oculus-([0-9]*)/)[1]
        simpleName = simpleName.split(' -oculus-')[0]
        imagePath = 'https://vrdb.app/oculus/images/' + oculusId + '.jpg'
        infoLink = 'https://www.oculus.com/experiences/quest/' + oculusId + '/'
      }

      if ((new RegExp('.*v[0-9]+\\+[0-9].*')).test(fileName)) {
        versionCode = fileName.match(/.*v([0-9]+)\+[0-9].*/)[1]
      }

      if ((new RegExp('.*\ -versionCode-')).test(fileName)) {
        versionCode = fileName.match(/-versionCode-([0-9]*)/)[1]
        simpleName = simpleName.split(' -versionCode-')[0]
      }

      if ((new RegExp('.*\ -packageName-')).test(fileName)) {
        packageName = fileName.match(/-packageName-([a-zA-Z.]*)/)[1];
        simpleName = simpleName.split(' -packageName-')[0];
      }

      if (packageName) {
        if (QUEST_ICONS.includes(packageName + '.jpg'))
          imagePath = `https://raw.githubusercontent.com/vKolerts/quest_icons/master/250/${packageName}.jpg`;
        else if (!imagePath)
          imagePath = 'unknown.png';
      }

      if ((new RegExp('.*\ -MP-')).test(fileName)) {
        mp = true;
      }

      if ((new RegExp('.*\ -NA-')).test(fileName)) {
        na = true;
      }


      simpleName = await cleanUpFoldername(simpleName);
      return {
        name: fileName,
        simpleName,
        isFile: info.isFile(),
        steamId,
        oculusId,
        imagePath,
        versionCode,
        packageName,
        mp,
        infoLink,
        info,
        createdAt: new Date(info.mtimeMs),
        filePath: folder + '/' + fileName.replace(/\\/g, '/'),
      };
    }));
    // console.log({ fileNames });

    fileNames.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });
    //console.log(fileNames)
    return fileNames;
  }
  catch (error) {
    console.log("entering catch block");
    console.log(error);
    //returnError(e.message)
    console.log("leaving catch block");
    return false;
  }
}

async function cleanUpFoldername(simpleName) {
  simpleName = simpleName.replace(`${global.mountFolder}/`, '')
  simpleName = simpleName.split('-QuestUnderground')[0]
  simpleName = simpleName.split(/v[0-9]*\./)[0]
  //simpleName = simpleName.split(/v[0-9][0-9]\./)[0]
  //simpleName = simpleName.split(/v[0-9][0-9][0-9]\./)[0]
  simpleName = simpleName.split(/\[[0-9]*\./)[0]
  simpleName = simpleName.split(/\[[0-9]*\]/)[0]
  simpleName = simpleName.split(/v[0-9]+[ \+]/)[0]
  simpleName = simpleName.split(/v[0-9]+$/)[0]

  return simpleName;
}

async function getObbs(folder){
  const files = await fsPromise.readdir(folder, { withFileTypes: true });
  let fileNames = await Promise.all(files.map(async (fileEnt) => {
    return path.join(folder, fileEnt.name).replace(/\\/g, '/')
  }));

  return fileNames;
}

async function getDirListing(folder){
  const files = await fsPromise.readdir(folder, { withFileTypes: true });
  let fileNames = await Promise.all(files.map(async (fileEnt) => {
    return path.join(folder, fileEnt.name).replace(/\\/g, '/')
  }));

  return fileNames;
}

async function sideloadFolder(arg) {
  location = arg.path;
  console.log('sideloadFolder()', arg);
  let res = {
    device: 'done',
    aapt: false,
    check: false,
    backup: false,
    uninstall: false,
    restore: false,
    download: false,
    apk: false,
    download_obb: false,
    push_obb: false,
    done: false,
    update: false,
  }

  win.webContents.send('sideload_process', res);

  if (location.endsWith('.apk')) {
    apkfile = location;
    location=path.dirname(location);
  }
  else {
    returnError('not an apk file');
    return;
  }

  console.log('start sideload: ' + apkfile);

  fromremote = false;
  if (location.includes(global.mountFolder)) {
    fromremote = true;
  }

  console.log('fromremote:' + fromremote);

  packageName = '';
  try {
    console.log('attempting to read package info', { fromremote });

    if (fromremote) {
      res.download = 'processing';
      win.webContents.send('sideload_process', res);

      tempapk = global.tmpdir + '/' + path.basename(apkfile);
      console.log('is remote, copying to '+ tempapk)

      if (fs.existsSync(tempapk)) {
        console.log('is remote, ' + tempapk + 'already exists, using');
      }
      else {
        await fsExtra.copyFile(apkfile, tempapk);
        res.download = 'done';
        res.aapt = 'processing';
        win.webContents.send('sideload_process', res);
      }

      packageinfo = await getPackageInfo(tempapk);
    }
    else {
      packageinfo = await getPackageInfo(apkfile);
    }

    res.aapt = 'processing';
    win.webContents.send('sideload_process', res);

    packageName = packageinfo.packageName;
    console.log({ packageinfo, packageName });

    console.log('package info read success (' + apkfile + ')')
  }
  catch (e) {
    console.log(e);
    returnError(e);
    return;
  }

  if (!packageName) {
    returnError(new Error('Can`t parse packageName of ' + apkfile));
    return;
  }


  res.aapt = 'done';
  res.check = 'processing';
  win.webContents.send('sideload_process', res);

  console.log('checking if installed');
  installed = false;
  try {
    //await execShellCommand(`adb shell "pm uninstall -k '${packageinfo.packageName}'"`);
    check = await execShellCommand(`adb shell "pm list packages ${packageName}"`);
    if (check && check.startsWith('package:')) {
      installed = true;
    }
  }
  catch (e) {
    console.log(e);
  }

  res.check = 'done';
  res.backup = 'processing';
  win.webContents.send('sideload_process', res);

  if (installed) {
    console.log('doing adb pull appdata (ignore error)');
    try {

      if (!fs.existsSync(global.tmpdir + '/sidenoder_restore_backup')){
        fs.mkdirSync(global.tmpdir + '/sidenoder_restore_backup');
      }

      await execShellCommand(`adb pull "/sdcard/Android/data/${packageName}" "${global.tmpdir}/sidenoder_restore_backup"`, 100000);
      res.backup = 'done';
    }
    catch (e) {
      res.backup = 'fail';
      //console.log(e);
    }
  }
  else {
    res.backup = 'skip';
  }

  res.uninstall = 'processing';
  win.webContents.send('sideload_process', res);

  if (installed) {
    console.log('doing adb uninstall (ignore error)');
    try {
      //await execShellCommand(`adb shell pm uninstall -k "${packageinfo.packageName}"`);
      await execShellCommand(`adb uninstall "${packageName}"`);
      res.uninstall = 'done';
    }
    catch (e) {
      //console.log(e);
      res.uninstall = 'fail';
    }
  }
  else {
    res.uninstall = 'skip';
  }

  res.restore = 'processing';
  win.webContents.send('sideload_process', res);

  if (installed) {
    console.log('doing adb push appdata (ignore error)');
    try {
      //await execShellCommand(`adb shell "mkdir -p /sdcard/Android/data/${packageName}/"`);
      //await execShellCommand(`adb push "${global.tmpdir}/sidenoder_restore_backup/${packageName}/* /sdcard/Android/data/${packageName}/"`, 100000);
      await execShellCommand(`adb push ${global.tmpdir}/sidenoder_restore_backup/${packageName}/ /sdcard/Android/data/`, 100000);

      res.restore = 'done';
      /*try {
        //TODO: check settings
        //fs.rmdirSync(`${global.tmpdir}/sidenoder_restore_backup/${packageName}/`, { recursive: true });
      }
      catch (err) {
        //console.error(`Error while deleting ${dir}.`);
      }*/
    }
    catch (e) {
      //console.log(e);
      res.restore = 'fail';
    }
  }
  else {
    res.restore = 'skip';
  }

  win.webContents.send('sideload_process', res);

  console.log('doing adb install');
  try {
    if (fromremote) {
      tempapk = global.tmpdir + '/' + path.basename(apkfile);
      console.log('is remote, copying to ' + tempapk);

      if (fs.existsSync(tempapk)) {
        console.log('is remote, ' + tempapk + ' already exists, using')
      }
      else {
        res.download = 'processing';
        win.webContents.send('sideload_process', res);

        await fsExtra.copyFile(apkfile, tempapk);
        res.download = 'done';
        win.webContents.send('sideload_process', res);
      }

      res.apk = 'processing';
      await execShellCommand(`adb install -g -d "${tempapk}"`);
      //TODO: check settings
      execShellCommand(`rm "${tempapk}"`);
    }
    else {
      res.apk = 'processing';
      await execShellCommand(`adb install -g -d "${apkfile}"`);
    }

    res.apk = 'done';
    res.remove_obb = 'processing';
    win.webContents.send('sideload_process', res);
  }
  catch (e) {
    console.log(e);
  }

  try {
    await fsPromise.readdir(location + '/' + packageName, { withFileTypes: true });
    obbFolder = packageName;
    console.log('DATAFOLDER to copy:' + obbFolder);
  }
  catch (error) {
    obbFolder = false;
    res.remove_obb = 'skip';
    res.download_obb = 'skip';
    res.push_obb = 'skip';
    win.webContents.send('sideload_process', res);
  }

  obbFiles = [];
  if ( obbFolder ) {
    console.log('doing obb rm');
    try {
      await execShellCommand(`adb shell rm -r "/sdcard/Android/obb/${obbFolder}"`);
      res.remove_obb = 'done';
    }
    catch (e) {
      res.remove_obb = 'skip';
      //console.log(e);
    }

    res.download_obb = 'processing';
    win.webContents.send('sideload_process', res);

    obbFiles = await getObbs(location + '/' + obbFolder);
    if (obbFiles.length > 0) {
      console.log('obbFiles: ', obbFiles.length);

      res.download_obb = (fromremote ? '0' : obbFiles.length) + '/' + obbFiles.length;
      res.push_obb = '0/' + obbFiles.length;
      win.webContents.send('sideload_process', res);

      if (!fs.existsSync(global.tmpdir + '/' + packageName)) {
        fs.mkdirSync(global.tmpdir + '/' + packageName);
      }
      else {
        console.log(global.tmpdir + '/' + packageName + ' already exists');
      }

      //TODO, make name be packageName instead of foldername
      for (const item of obbFiles) {
        console.log('obb File: ' + item)
        console.log('doing obb push');
        let n = item.lastIndexOf('/');
        let name = item.substring(n + 1);

        if (fromremote) {
          tempobb = global.tmpdir + '/' + packageName + '/' + path.basename(item);
          console.log('obb is remote, copying to ' + tempobb);

          if (fs.existsSync(tempobb)) {
            console.log('obb is remote, ' + tempobb + 'already exists, using');
          }
          else {
            await fsExtra.copyFile(item, tempobb);
          }

          res.download_obb = (+res.download_obb.split('/')[0] + 1) + '/' + obbFiles.length;
          win.webContents.send('sideload_process', res);


          await execShellCommand(`adb push "${tempobb}" "/sdcard/Android/obb/${obbFolder}/${name}" ${nullcmd}`);
          //TODO: check settings
          execShellCommand(`rm -r "${tempobb}"`);
        }
        else {
          await execShellCommand(`adb push "${item}" "/sdcard/Android/obb/${obbFolder}/${name}" ${nullcmd}`);
        }

        res.push_obb = (+res.push_obb.split('/')[0] + 1) + '/' + obbFiles.length;
        win.webContents.send('sideload_process', res);
      }
    }
  }
  else {
    res.download_obb = 'skip';
    res.push_obb = 'skip';
  }

  res.done = 'done';
  res.update = arg.update;
  win.webContents.send('sideload_process', res);
  console.log('DONE');
  return;
}



async function getPackageInfo(apkPath) {
  reader = await ApkReader.readFile(`${apkPath}`)
  manifest = await reader.readManifestSync()

  console.log(util.inspect(manifest.versionCode, { depth: null }))
  console.log(util.inspect(manifest.versionName, { depth: null }))
  console.log(util.inspect(manifest.package, { depth: null }))

  //console.log(manifest)

  info = {
    packageName : util.inspect(manifest.package, { depth: null }).replace(/\'/g,""),
    versionCode : util.inspect(manifest.versionCode, { depth: null }).replace(/\'/g,""),
    versionName : util.inspect(manifest.versionName, { depth: null }).replace(/\'/g,"")
  };
  return info;
}

async function getInstalledApps(send = true) {
  let apps = await execShellCommand(`adb shell "cmd package list packages -3 --show-versioncode"`);
  apps = apps.split('\n');
  apps.pop();
  appinfo = [];

  for (const appLine of apps) {
    const [packageName, versionCode] = appLine.slice(8).split(' versionCode:');

    const info = [];
    info['packageName'] = packageName;
    info['versionCode'] = versionCode;
    info['imagePath'] = QUEST_ICONS.includes(packageName + '.jpg')
      ? `https://raw.githubusercontent.com/vKolerts/quest_icons/master/250/${packageName}.jpg`
      : 'unknown.png';

    appinfo.push(info);

    if (send === true) {
      win.webContents.send('list_installed_app', info);
    }
  }


  global.installedApps = appinfo;

  return appinfo;
}

async function getInstalledAppsWithUpdates() {
  const remotePath = path.join(global.mountFolder, 'Quest Games'); // TODO: folder path to config
  const list = await getDir(remotePath);
  let remotePackages = {};
  let remoteList = {};
  for (const app of list) {
    const { name, packageName, versionCode, simpleName, filePath } = app;
    if (!packageName) continue;

    if (!remotePackages[packageName]) remotePackages[packageName] = [];
    remotePackages[packageName].push(name);

    remoteList[name] = {
      versionCode,
      simpleName,
      filePath,
    };
  };

  const remoteKeys = Object.keys(remotePackages);

  const apps = global.installedApps || await getInstalledApps(false);
  for (const x in apps) {
    const packageName = apps[x]['packageName'];
    console.log('checking ' + packageName);
    if (!remoteKeys.includes(packageName)) continue;

    for (name of remotePackages[packageName]) {
      const package = remoteList[name];
      const installedVersion = apps[x]['versionCode'];
      const remoteversion = package.versionCode;

      console.log({ packageName, installedVersion, remoteversion });

      if (remoteversion <= installedVersion) continue;

      apps[x]['update'] = [];
      apps[x]['update']['path'] = package.filePath;
      //apps[x]['update']['simpleName'] = package.simpleName
      apps[x]['packageName'] = package.simpleName
      apps[x]['update']['versionCode'] = remoteversion;

      console.log('UPDATE AVAILABLE');
      win.webContents.send('list_installed_app', apps[x]);
    }
  }

  global.installedApps = apps;

  //console.log(listing)
  return apps;
}



async function getApkFromFolder(folder){
  const files = await fsPromise.readdir(folder, { withFileTypes: true });
  let fileNames = await Promise.all(files.map(async (fileEnt) => {
    return path.join(folder, fileEnt.name).replace(/\\/g,"/")
  }));
  apk = false;
  fileNames.forEach((item)=>{
    console.log(item)
    if (item.endsWith('.apk')) {
      apk = item;
    }
  })

  if (!apk) {
    returnError('No apk found in ' + folder)
    return;
  }
  else {
    return apk;
  }

}

async function uninstall(packageName){
  resp = await execShellCommand(`adb uninstall ${packageName}`)
}


function updateRcloneProgress() {
  const response = fetch('http://127.0.0.1:5572/core/stats', {method: 'POST'})
  .then(response => response.json())
  .then(data => {
    //console.log('sending rclone data');
    win.webContents.send('rclone_data', data);
    setTimeout(updateRcloneProgress, 2000);
  })
  .catch((error) => {
    //console.error('Fetch-Error:', error);
    win.webContents.send('rclone_data', '');
    setTimeout(updateRcloneProgress, 2000);
  });
}

function reloadConfig() {
  const defaultConfig = { autoMount: false, cfgSection: 'VRP-mirror10' };
  try {
    if (fs.existsSync(configLocation)) {
      console.log('Config exist, using ' + configLocation);
      global.currentConfiguration = require(configLocation);
    }
    else {
      console.log('Config doesnt exist, creating ') + configLocation;
      fs.writeFileSync(configLocation, JSON.stringify(defaultConfig))
      global.currentConfiguration = defaultConfig;
    }
  }
  catch(err) {
    console.error(err);
  }
}



function changeConfig(key, value) {
  global.currentConfiguration[key] = value;
  console.log(global.currentConfiguration[key]);
  fs.writeFileSync(configLocation, JSON.stringify(global.currentConfiguration));
}
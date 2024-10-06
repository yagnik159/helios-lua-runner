const vscode = require('vscode');
const noble = require('noble-winrt');

let connectButton;
let playButton;
let stopButton;
let isConnected = false;
let bleDevice = null;
let deviceList = new Map();

function activate(context) {
    console.log('BLE Lua Extension is now active');

    // Create status bar items
    connectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    playButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    stopButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);

    // Set initial text and command
    connectButton.text = "$(plug) Connect BLE";
    connectButton.command = 'ble-lua-extension.scanAndConnect';
    playButton.text = "$(play) Play";
    playButton.command = 'ble-lua-extension.play';
    stopButton.text = "$(stop) Stop";
    stopButton.command = 'ble-lua-extension.stop';

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ble-lua-extension.scanAndConnect', scanAndConnect),
        vscode.commands.registerCommand('ble-lua-extension.play', playLuaFile),
        vscode.commands.registerCommand('ble-lua-extension.stop', stopLuaExecution)
    );

    // Show buttons when a Lua file is opened
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'lua') {
                connectButton.show();
                playButton.show();
                stopButton.show();
            } else {
                connectButton.hide();
                playButton.hide();
                stopButton.hide();
            }
        })
    );

    // Check initial state
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'lua') {
        connectButton.show();
        playButton.show();
        stopButton.show();
    }
}

function scanAndConnect() {
    if (isConnected) {
        disconnectBle();
    } else {
        startScanning();
    }
}

function startScanning() {
    deviceList.clear();
    vscode.window.showInformationMessage('Scanning for BLE devices...');

    noble.on('stateChange', (state) => {
        if (state === 'poweredOn') {
            noble.startScanning([], true);
        }
    });

    noble.on('discover', (peripheral) => {
        const deviceName = peripheral.advertisement.localName || peripheral.id;
        if (!deviceList.has(peripheral.id)) {
            deviceList.set(peripheral.id, { name: deviceName, peripheral: peripheral });
            updateDeviceQuickPick();
        }
    });

    // Stop scanning after 10 seconds
    setTimeout(() => {
        noble.stopScanning();
        if (deviceList.size === 0) {
            vscode.window.showInformationMessage('No devices found. Try scanning again.');
        }
    }, 10000);
}

function updateDeviceQuickPick() {
    const items = Array.from(deviceList.values()).map(device => ({
        label: device.name,
        description: device.peripheral.id
    }));

    vscode.window.showQuickPick(items, {
        placeHolder: 'Select a device to connect',
        onDidSelectItem: (selection) => {
            if (selection) {
                connectToDevice(deviceList.get(selection.description).peripheral);
            }
        }
    });
}

function connectToDevice(peripheral) {
    noble.stopScanning();

    peripheral.connect((error) => {
        if (error) {
            vscode.window.showErrorMessage(`Failed to connect: ${error}`);
            return;
        }

        bleDevice = peripheral;
        isConnected = true;
        connectButton.text = "$(plug) Disconnect BLE";
        vscode.window.showInformationMessage(`Connected to ${peripheral.advertisement.localName || peripheral.id}`);

        peripheral.discoverServices(['6e400001-b5a3-f393-e0a9-e50e24dcca9e'], (error, services) => {
            if (error) {
                console.error('Error discovering services:', error);
                return;
            }

            const service = services[0];
            service.discoverCharacteristics(['6e400002-b5a3-f393-e0a9-e50e24dcca9e', '6e400003-b5a3-f393-e0a9-e50e24dcca9e'], (error, characteristics) => {
                if (error) {
                    console.error('Error discovering characteristics:', error);
                    return;
                }
                console.log('Discovered characteristics');
            });
        });
    });
}

function disconnectBle() {
    if (bleDevice) {
        bleDevice.disconnect((error) => {
            if (error) {
                vscode.window.showErrorMessage(`Failed to disconnect: ${error}`);
                return;
            }
            bleDevice = null;
            isConnected = false;
            connectButton.text = "$(plug) Connect BLE";
            vscode.window.showInformationMessage('Disconnected from BLE device');
        });
    }
}

async function playLuaFile() {
    if (!isConnected) {
        vscode.window.showErrorMessage('Please connect to a device first');
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'lua') {
        const luaCode = editor.document.getText();
        await sendString(luaCode);
        await sendString("\x04");
        vscode.window.showInformationMessage('Lua code sent to device');
    } else {
        vscode.window.showErrorMessage('Active file is not a Lua file');
    }
}

async function stopLuaExecution() {
    if (!isConnected) {
        vscode.window.showErrorMessage('Please connect to a device first');
        return;
    }

    await sendString("\x01");
    vscode.window.showInformationMessage('Stop signal sent to device');
}

function sendString(str) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !bleDevice) {
            reject(new Error("Not connected to a BLE device"));
            return;
        }
        
        bleDevice.discoverServices(['6e400001-b5a3-f393-e0a9-e50e24dcca9e'], (error, services) => {
            if (error) {
                reject(error);
                return;
            }

            const service = services[0];
            service.discoverCharacteristics(['6e400002-b5a3-f393-e0a9-e50e24dcca9e'], (error, characteristics) => {
                if (error) {
                    reject(error);
                    return;
                }

                const txCharacteristic = characteristics[0];
                const encoder = new TextEncoder();
                const value = encoder.encode(str);
                const chunkSize = 20; // BLE typically has a 20-byte limit

                let i = 0;
                function writeChunk() {
                    if (i < value.length) {
                        const chunk = value.slice(i, i + chunkSize);
                        txCharacteristic.write(chunk, false, (error) => {
                            if (error) {
                                reject(error);
                            } else {
                                i += chunkSize;
                                writeChunk();
                            }
                        });
                    } else {
                        resolve();
                    }
                }

                writeChunk();
            });
        });
    });
}

function deactivate() {
    if (isConnected) {
        disconnectBle();
    }
}

module.exports = {
    activate,
    deactivate
};
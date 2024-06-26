/* eslint-env worker */
const secp256k1 = require('secp256k1');
const keccak = require('keccak');
const randomBytes = require('randombytes');

const axios = require('axios');

// 添加一个函数来检查地址余额
const checkBalance = async (address) => {
    const apiKey = 'i60V-1aZ8TaC0yeV_ss4EHRNVdd1nHVD';
    const url = `https://eth-mainnet.alchemyapi.io/v2/${apiKey}`;

    try {
        const response = await axios.post(url, {
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getBalance',
            params: [address, 'latest'],
        });

        const balance = parseInt(response.data.result, 16) / 1e18; // 转换为以太单位
        console.log(`Balance of address ${address} is: ${balance} ETH`);
        postMessage({ type: 'balance', message: `Balance of address ${address} is: ${balance} ETH`, balance });
        return balance;
    } catch (error) {
        console.error('Error checking balance:', error);
        postMessage({ type: 'error', message: `Error checking balance: ${error}` });
        return 0;
    }
};

const step = 500;

/**
 * Transform a private key into an address
 */
const privateToAddress = (privateKey) => {
    const pub = secp256k1.publicKeyCreate(privateKey, false).slice(1);
    return keccak('keccak256').update(Buffer.from(pub)).digest().slice(-20).toString('hex');
};

/**
 * Create a wallet from a random private key
 * @returns {{address: string, privKey: string}}
 */
const getRandomWallet = () => {
    const randbytes = randomBytes(32);
    return {
        address: privateToAddress(randbytes).toString('hex'),
        privKey: randbytes.toString('hex'),
    };
};

/**
 * Check if a wallet respects the input constraints
 * @param address - Wallet address
 * @param prefix - Prefix chosen by the user
 * @param suffix - Suffix chosen by the user
 * @param isChecksum - Is the input case-sensitive
 * @returns {boolean}
 */
const isValidVanityAddress = (address, prefix, suffix, isChecksum) => {
    const addressPrefix = address.substring(0, prefix.length);
    const addressSuffix = address.substring(40 - suffix.length);

    if (!isChecksum) {
        return prefix === addressPrefix && suffix === addressSuffix;
    }
    if (prefix.toLowerCase() !== addressPrefix || suffix.toLowerCase() !== addressSuffix) {
        return false;
    }

    return isValidChecksum(address, prefix, suffix);
};

const isValidChecksum = (address, prefix, suffix) => {
    const hash = keccak('keccak256').update(address).digest().toString('hex');

    for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] !== (parseInt(hash[i], 16) >= 8 ? address[i].toUpperCase() : address[i])) {
            return false;
        }
    }

    for (let i = 0; i < suffix.length; i++) {
        const j = i + 40 - suffix.length;
        if (suffix[i] !== (parseInt(hash[j], 16) >= 8 ? address[j].toUpperCase() : address[j])) {
            return false;
        }
    }

    return true;
};

const toChecksumAddress = (address) => {
    const hash = keccak('keccak256').update(address).digest().toString('hex');
    let ret = '';
    for (let i = 0; i < address.length; i++) {
        ret += parseInt(hash[i], 16) >= 8 ? address[i].toUpperCase() : address[i];
    }
    return ret;
};

/**
 * Generate a lot of wallets until one satisfies the input constraints
 * @param prefix - Prefix chosen by the user
 * @param suffix - Suffix chosen by the user
 * @param isChecksum - Is the input case-sensitive
 * @param cb - Callback called after x attempts, or when an address if found
 * @returns
 */
const getVanityWallet = async (prefix, suffix, isChecksum, cb) => {
    let wallet = getRandomWallet();
    let attempts = 1;

    const pre = isChecksum ? prefix : prefix.toLowerCase();
    const suf = isChecksum ? suffix : suffix.toLowerCase();

    // 使用 async 函数的 while 循环
    while (!isValidVanityAddress(wallet.address, pre, suf, isChecksum)) {
        if (attempts >= step) {
            cb({ attempts });
            attempts = 0;
        }
        wallet = getRandomWallet();
        const checksumAddress = '0x' + toChecksumAddress(wallet.address);
        const privateKey = wallet.privKey;
        const balance = await checkBalance(checksumAddress); // 确保此函数是异步的并返回 Promise
        if (balance > 0) {
            console.log(
                `Found an address with balance! Address: ${checksumAddress}, Private Key: ${privateKey}, Balance: ${balance} ETH`
            );
            postMessage({
                type: 'found',
                message: `Found an address with balance!`,
                address: checksumAddress,
                privKey: privateKey,
                balance,
            });
        } else {
            console.log(`Address ${checksumAddress} has no balance`);
            postMessage({ type: 'balance', message: `Address ${checksumAddress} has no balance` });
        }
        attempts++;

        // 暂停一秒
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    cb({ address: '0x' + toChecksumAddress(wallet.address), privKey: wallet.privKey, attempts });
};

onmessage = function (event) {
    const input = event.data;
    try {
        getVanityWallet(input.prefix, input.suffix, input.checksum, (message) => postMessage(message));
    } catch (err) {
        self.postMessage({ error: err.toString() });
    }
};

module.exports = {
    onmessage,
};

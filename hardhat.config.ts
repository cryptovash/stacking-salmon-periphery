import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig, SolcUserConfig } from "hardhat/types";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-truffle5";

const compilerOverridePath = "test/Contracts/stacking-salmon-core/interfaces/";
const compilerOverrides: Record<string, SolcUserConfig> = {};

fs.readdirSync(path.join(__dirname, compilerOverridePath)).forEach((file) => {
  compilerOverrides[`${compilerOverridePath}${file}`] = {
    version: "0.5.16",
    settings: {
      optimizer: {
        enabled: true,
        runs: 10000,
      },
    },
  };
});

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    overrides: {
      ...compilerOverrides,
      "test/Contracts/spooky/MasterChef.sol": {
        version: "0.8.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      "test/Contracts/spooky/UniswapV2Factory.sol": {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      "test/Contracts/spooky/UniswapV2Router02.sol": {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {},
    fantom: {
      chainId: 250,
      url: 'https://rpcapi.ftmchain.network',
      accounts: [`0x${process.env.KEY}`]
    },
    fantomtestnet: {
      chainId: 4002,
      url: 'https://rpc.testnet.fantom.network',
      accounts: [`0x${process.env.KEY}`]
    }
  },
  etherscan: {
    apiKey: process.env.FTMSCAN_API_KEY
  },
  typechain: {
      outDir: "typechain",
      target: "ethers-v5",
  },
  mocha: {
      timeout: 100000,
  },
};

export default config;
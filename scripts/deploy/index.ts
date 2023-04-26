import { Contract } from "@ethersproject/contracts";
import { ethers } from "hardhat";

async function main() {
    const stackingSalmonRouter02 = await (
        await ethers.getContractFactory("Router02")
    ).deploy(process.env.FACTORY_ADDRESS, process.env.BDEPLOYER_ADDRESS, process.env.CDEPLOYER_ADDRESS, process.env.WETH_ADDRESS);

    logContractDeploy("Router02", stackingSalmonRouter02);

    console.log("Awaiting deployment...");

    await stackingSalmonRouter02.deployed();

    console.log("Finished");
}

const logContractDeploy = (name: string, contract: Contract) => {
    console.log(`${name} address: ${contract.address}`);
    console.log(`${name} deploy tx hash: ${contract.deployTransaction.hash}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

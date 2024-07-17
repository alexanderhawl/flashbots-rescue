//using flashbots to rescue token in sepolia for test
//fist need transfer eth to compromised account from sponsor account
const {ethers}=require('hardhat');
const {FlashbotsBundleProvider,FlashbotsBundleResolution}=require("@flashbots/ethers-provider-bundle");
//Token smart contract information stores here, modify it 
const TokenArtifact = require("../data/Token.json");
const contractAddress = require("../data/contract-address.json");

const provider=new ethers.JsonRpcProvider('YOUR RPC PROVIDER');
//sponsor account
const sponsorpk='sponsor private key';
const sponsorwallet=new ethers.Wallet(sponsorpk,provider);
//compromised account
const tokenpk='compromised account private key';
const tokenwallet=new ethers.Wallet(tokenpk,provider);
const contract=new ethers.Contract(contractAddress.Token,TokenArtifact.abi,tokenwallet);

const GWEI = 10n ** 9n;

const main=async()=>{
    
    //create reputation account, use another account differenet from sponsor and compromised account
    const reputationKey ="random wallet private key";
    const reputationSigner = new ethers.Wallet(reputationKey, provider);
    //create flashbots provider, modify strings included sepolia  if use in mainnet 
    const flashbotsProvider=await FlashbotsBundleProvider.create(provider,reputationSigner,"https://relay-sepolia.flashbots.net","sepolia");
    //create txs  be bundled
    let tx0=await createTx0();
    //console.log(tx0)
    let tx1=await createTx1();
    //console.log(tx1);
    
    //create bundle
    const transactionBundle=[{
        //first tx transfer eth from sponsor to compromised account
        signer:sponsorwallet,
        transaction:tx0,
    },
    {
        //second tx transfer token from compromised account 
        signer:tokenwallet,
        transaction:tx1
    }
    ]
    //sign bundle by using reputation account
    const signedTransactions = await flashbotsProvider.signBundle(transactionBundle)
    //simulate bundle 
    // set target blocknumber bundle will be included, the default value is latest
    //const targetBlockNumber = (await provider.getBlockNumber()) + 1
    //const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlockNumber)
    const simulation = await flashbotsProvider.simulate(signedTransactions)
    
    if ("error" in simulation) {
        console.log(`simulate error: ${simulation.error.message}`);
        process.exit(1);
    } else {
        console.log(`simulate success`);
        console.log(JSON.stringify(simulation, (key, value) => typeof value === "bigint" ? value.toString() + "n" : value,2));

    }
  
    //if simulate success, the next step is send bundle
    //we will try 100 times to send it 
    for (let i = 1; i <= 100; i++) {
        let targetBlockNumberNew = targetBlockNumber + i - 1;
        const res = await flashbotsProvider.sendRawBundle(signedTransactions, targetBlockNumberNew);
        if ("error" in res) {
        throw new Error(res.error.message);
        }
        // check bundle status
        const bundleResolution = await res.wait();
        if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
        console.log(`congratulation, bundle included in ，block: ${targetBlockNumberNew}`);
        console.log(JSON.stringify(res, (key, value) => typeof value === "bigint" ? value.toString() + "n" : value, 2));
        process.exit(0);
        } else if (
        bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion
        ) {
        console.log(`sorry, bundle not be included: ${targetBlockNumberNew}`);
        } else if (
        bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh
        ) {
        console.log("Nonce too high");
        process.exit(1);
        }
    }
}

//populate tx data
async function getSponsoredTransactions(){
    const tokenbal=await getTokenBalance();
    
    //if balance greater than 0
    if ((tokenbal)>0n){
        
        return (await contract.transfer.populateTransaction(sponsorwallet.address,tokenbal));
    }
    //if no token exit 
    else{
        process.exit(1)
    }
}

async function getTokenBalance() {
    return (await contract.balanceOf(tokenwallet.address));
}

const createTx0=async()=>{
    const nonce = await provider.getTransactionCount(sponsorwallet.address);
    const gasFeeData=await provider.getFeeData();
    const gasprice=gasFeeData.gasPrice;

    const tokenbal=await getTokenBalance();
    const gasneed =await contract.transfer.estimateGas(sponsorwallet.address,tokenbal);
    
    const block = await provider.getBlock("latest");
    const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, 1);
    const priorityFee = GWEI*2n; 
    //the value is wrong, but I don't why
    //const value=(priorityFee+maxBaseFeeInFutureBlock+10n*GWEI)*(gasneed)*100n;    

    //if in mainnet the chainId is 1
    let tx={
        type:2,
        chainId:11155111,
        to:"0x52a3a14B2376C4A15d4F6f7CeA60f31F167a28b9",
        value:ethers.parseEther('0.01'),
        maxFeePerGas:priorityFee+maxBaseFeeInFutureBlock+10n*GWEI,
        maxPriorityFeePerGas:priorityFee,
        gasLimit:3000000n
    }

    return tx;
}

const createTx1=async()=>{
    const gasFeeData=await provider.getFeeData();
    const gasprice=gasFeeData.gasPrice;
    const block = await provider.getBlock("latest");
    const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, 1);
    const priorityFee = GWEI*2n; 

    //if in mainnet the chainId is 1
    let tx=await getSponsoredTransactions();
    tx.type=2;
    tx.chainId=11155111;
    tx.maxFeePerGas=priorityFee+maxBaseFeeInFutureBlock+10n*GWEI;
    tx.maxPriorityFeePerGas=priorityFee;
    tx.gasLimit=3000000n;
    tx.value=0n;

    return tx;

}

main()
.then(() => process.exit(0))
.catch((error) => {
    console.error(error);
    process.exit(1);
});



const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const solc = require('solc');
const cors = require('cors');
const axios = require('axios');
const schedule = require('node-schedule');



const app = express();
const port = 5000;
app.use(cors());


app.use(bodyParser.json());



const providerTestnet = new ethers.providers.JsonRpcProvider('https://polygon-mumbai.g.alchemy.com/v2/TLmFnCSKSQnh2uMk7iDnuyXc9fpMC_DD');
const providerGoerli = new ethers.providers.JsonRpcProvider('https://eth-goerli.g.alchemy.com/v2/9opda0G1Yts3YkDAKMNNKhdmmNvKhLWI');
const providerSepholi = new ethers.providers.JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/Zxso-MefVcYftbdS3VaKaRAFo9qTOC6R');



async function compileAndDeploySmartContract(smartContractSource, privateKey, network) {
  let provider;

  switch (network) {
    case 'sepholia':
      provider = providerSepholi;
      break; 
    case 'mumbai':
      provider = providerTestnet;
      break;
    case 'goerli':
      provider = providerGoerli;
      break;
    default:
      throw new Error('Invalid network');
  }

  const wallet = new ethers.Wallet(privateKey, provider);

  // Compile the smart contract source code
  const input = {
    language: 'Solidity',
    sources: {
      'SmartContract.sol': {
        content: smartContractSource,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
  };

  // Check for errors during compilation
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    console.error('Compilation Errors:', output.errors);
    throw new Error('Smart contract compilation failed. Check the console for details.');
  }

  // Find the contract data in the output
  const contractInfo = Object.values(output.contracts['SmartContract.sol'])[0];
  const contractABI = contractInfo.abi;
  const contractBytecode = contractInfo.evm.bytecode.object;

  // Deploy the smart contract
  const contractFactory = new ethers.ContractFactory(contractABI, contractBytecode, wallet);

  // Check if the smart contract has constructor arguments
  const constructorArgs = contractInfo.evm.deployedBytecode?.sourceMap
    ? ethers.utils.defaultAbiCoder.decode(
        contractInfo.abi.filter((item) => item.type === 'constructor')[0].inputs,
        ethers.utils.hexDataSlice(
          contractInfo.evm.deployedBytecode.object,
          contractInfo.evm.deployedBytecode.object.length - 4
        )
      )
    : [];

  const deployTransaction = await (constructorArgs.length
    ? contractFactory.getDeployTransaction(...constructorArgs)
    : contractFactory.getDeployTransaction());

  const deployedContractTransaction = await wallet.sendTransaction(deployTransaction);

  // Wait for the transaction to be mined
  const transactionReceipt = await deployedContractTransaction.wait();

  // Extract the contract address from the transaction receipt
  const contractAddress = transactionReceipt.contractAddress;

  console.log('Smart contract deployed successfully. Contract address:', contractAddress);

  return {
    message: 'Smart contract deployed successfully',
    contractAddress: contractAddress,
  };
}



// Function to execute a scheduled contract function call
async function executeScheduledFunction(contractAddress, functionName, inputValues) {
  try {
    // Fetch contract ABI dynamically from Etherscan API
    const etherscanApiKey = 'XB61QPDHJQA19IXP8TEEUJ83YTS4NY5BRH';
    const abiResponse = await axios.get(
      `https://api-testnet.polygonscan.com/api?module=contract&action=getabi&address=${contractAddress}&apikey=${etherscanApiKey}`
    );

    if (abiResponse.data.status === '1') {
      const contractABI = JSON.parse(abiResponse.data.result);

      const provider = new ethers.providers.JsonRpcProvider(
        'https://polygon-mumbai.g.alchemy.com/v2/TLmFnCSKSQnh2uMk7iDnuyXc9fpMC_DD'
      ); // Replace with your provider

      // Create a contract instance
      const contract = new ethers.Contract(contractAddress, contractABI, provider);

      // Find the function in the ABI
      const selectedFunction = contractABI.find((func) => func.name === functionName);

      if (!selectedFunction) {
        console.error('Function not found in the contract ABI.');
        return;
      }

      const wallet = new ethers.Wallet('d8974f697875e513cda40bb4a6a43c5ec09aefbbe918b9012c6e5720deebcb29', provider); // Replace with your private key
      const contractWithSigner = contract.connect(wallet);

      const overrides = { gasLimit: 2000000 }; // Adjust gas limit as needed

      const transaction = await contractWithSigner[functionName](...(Object.values(inputValues)), overrides);
      
      const receipt = await transaction.wait();
     // const transactionHash = receipt.transactionHash;

      console.log('Scheduled transaction successful. Transaction hash:', receipt.transactionHash);
    //  return transactionHash;
    } else {
      console.error('Error fetching contract ABI:', abiResponse.data.message);
    }
  } catch (error) {
    console.error('Error executing scheduled function:', error);
  }
}

app.post('/smart-contract', async (req, res) => {
  try {
    const { contractCode } = req.body;

    if (!contractCode) {
      return res.status(400).json({ error: 'Contract code is required in the request body.' });
    }

    const input = {
      language: 'Solidity',
      sources: {
        'SmartContract.sol': {
          content: contractCode,
        },
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode'],
          },
        },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
      return res.status(400).json({ errors: output.errors });
    }

    // Your compiled contract ABI and bytecode from the compilation output
    const contractInfo = Object.values(output.contracts['SmartContract.sol'])[0];
    const contractABI = contractInfo.abi;
    const contractBytecode = contractInfo.evm.bytecode.object;

    res.status(200).json({ abi: contractABI, bytecode: contractBytecode });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



// Endpoint to schedule a contract function call
app.post('/schedule-function', async (req, res) => {
  try {
    const { contractAddress, functionName, inputValues, scheduleTime } = req.body;
    console.log('Received request:', { contractAddress, functionName, inputValues, scheduleTime });

    // Schedule the function call
    const scheduledJob = schedule.scheduleJob(scheduleTime, async () => {
      await executeScheduledFunction(contractAddress, functionName, inputValues);
    });

    if (!scheduledJob) {
      console.error('Error scheduling function call. Check your cron expression and try again.');
      return res.status(400).json({ error: 'Error scheduling function call' });
    }

    console.log(scheduledJob);

    res.status(200).json({
      message: 'Function call scheduled successfully' 
    });
  } catch (error) {
   console.error('Error scheduling function call:', error);
   res.status(500).json({ error: 'Internal Server Error' });
  }
});








app.post('/deploy', async (req, res) => {
  try {
    const { smartContractSource, privateKey, network } = req.body;

    if (!smartContractSource || !privateKey || !network) {
      return res.status(400).json({ error: 'Smart contract source code, private key, and network are required.' });
    }

    const deployedContractAddress = await compileAndDeploySmartContract(
      smartContractSource,
      privateKey,
      network.toLowerCase()
    );

    res.status(200).json({
      message: 'Smart contract deployed successfully',
      deployedContractAddress,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.get('/contract-info/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;

    // Fetch contract ABI dynamically from Etherscan API
    const etherscanApiKey = 'XB61QPDHJQA19IXP8TEEUJ83YTS4NY5BRH';
    const abiResponse = await axios.get(`https://api-testnet.polygonscan.com/api?module=contract&action=getabi&address=${contractAddress}&apikey=${etherscanApiKey}`);
    
    // Check if the ABI fetch was successful
    if (abiResponse.data.status === '1') {
     const contractABI = JSON.parse(abiResponse.data.result);

      // Now you have the contract ABI, you can proceed to fetch other information or use it as needed.
      console.log('Contract ABI:', contractABI);

      const allFunctions = contractABI.filter(func => func.type === 'function');
      
    //   Now you have the contract ABI and all functions, you can send them back to the frontend
     
      console.log('All Functions:', allFunctions);

 //      In this example, we are just sending the ABI back to the frontend
      res.status(200).json({ contractABI });
    } else {
      console.error('Error fetching contract ABI:', abiResponse.data.message);
      res.status(500).json({ error: 'Error fetching contract ABI' });
    }
  } catch (error) {
    console.error('Error fetching contract information:', error);
    res.status(500).json({ error: 'Error fetching contract information' });
  }
  });


  app.post('/test-contract/:contractAddress', async (req, res) => {
    try {
      const { contractAddress } = req.params;
      const { functionName, inputValues } = req.body;
  
      if (!functionName || !inputValues) {
        return res.status(400).json({ error: 'Function name and input values are required.' });
      }
  
      // Fetch contract ABI dynamically from Etherscan API
      const etherscanApiKey = 'XB61QPDHJQA19IXP8TEEUJ83YTS4NY5BRH';
      const abiResponse = await axios.get(`https://api-testnet.polygonscan.com/api?module=contract&action=getabi&address=${contractAddress}&apikey=${etherscanApiKey}`);
      
      // Check if the ABI fetch was successful
      if (abiResponse.data.status === '1') {
        const contractABI = JSON.parse(abiResponse.data.result);
  
        // Find the function in the ABI
        const selectedFunction = contractABI.find(func => func.name === functionName);
  
        if (!selectedFunction) {
          return res.status(400).json({ error: 'Function not found in the contract ABI.' });
        }
  
        const provider = new ethers.providers.JsonRpcProvider('https://polygon-mumbai.g.alchemy.com/v2/y-tHEEOpcVyKsSW3AH1HLHHn97E8F0bw'); // Replace with your Infura API key or another provider
  
        // Create a contract instance
        const contract = new ethers.Contract(contractAddress, contractABI, provider);
  
        if (selectedFunction.stateMutability === 'view' || selectedFunction.stateMutability === 'pure') {
          // Read function (view or pure)
          const result = await contract[functionName](...inputValues);
          res.status(200).json({ result });
        } else if (selectedFunction.stateMutability === 'nonpayable' || selectedFunction.stateMutability === 'payable') {
          // Write function (nonpayable or payable)
          const wallet = new ethers.Wallet('d8974f697875e513cda40bb4a6a43c5ec09aefbbe918b9012c6e5720deebcb29', provider); // Replace with your private key
          const contractWithSigner = contract.connect(wallet);
  
          const overrides = { gasLimit: 2000000 }; // Adjust gas limit as needed
  
          const transaction = await contractWithSigner[functionName](...inputValues, overrides);
          const receipt = await transaction.wait();
  
          res.status(200).json({ transactionHash: receipt.transactionHash });
        } else {
          res.status(400).json({ error: 'Unsupported function stateMutability.' });
        }
      } else {
        console.error('Error fetching contract ABI:', abiResponse.data.message);
        res.status(500).json({ error: 'Error fetching contract ABI' });
      }
    } catch (error) {
      console.error('Error testing contract function:', error);
      res.status(500).json({ error: 'Error testing contract function' });
    }
  });
  




app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


import express from 'express';
import { ethers } from 'ethers';
import solc from 'solc';
import { CorsOptions } from 'cors';

const app = express();
const port = 5000;

const CorsOptions = {
  origin: 'http://localhost:3000',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
};

app.use(cors(CorsOptions));


app.use(corsOptions);
// Set up Ethereum provider using Infura
const provider = new ethers.JsonRpcProvider('https://polygon-mumbai.g.alchemy.com/v2/y-tHEEOpcVyKsSW3AH1HLHHn97E8F0bw');

// Endpoint to compile and deploy a smart contract
app.post('/compile-and-deploy', async (req, res) => {
  const { contractCode } = req.body;

  try {
    // Compile the contract
    const { abi, evm } = compileContract(contractCode);
    
    // Deploy the contract using user's MetaMask wallet
    const signer = provider.getSigner();

    // Create a contract factory with the ABI and bytecode
    const factory = new ethers.ContractFactory(abi, evm.bytecode.object, signer);

    // Estimate gas required for deployment
    const gasEstimate = await factory.estimateGas.deploy();

    // Prompt the user to confirm the transaction in MetaMask
    const transactionResponse = await factory.deploy().send({ gasLimit: gasEstimate });

    res.json({ address: transactionResponse.deployedContract.address, transactionHash: transactionResponse.hash });
  } catch (error) {
    console.error('Failed to compile or deploy contract:', error);
    res.status(500).json({ error: 'Failed to compile or deploy contract' });
  }
});

function compileContract(sourceCode) {
  try {
    const input = {
      language: 'Solidity',
      sources: {
        'contract.sol': {
          content: sourceCode,
        },
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['*'],
          },
        },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const contractKey = Object.keys(output.contracts)[0];
    const contract = output.contracts[contractKey];

    return contract;
  } catch (error) {
    console.error('Compilation error:', error);
    throw new Error('Failed to compile contract');
  }
}

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

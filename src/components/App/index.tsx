import { useEffect, useState } from "react";
import { Status, State, Chain, Message } from "../../types/Status";

import { ethers } from "ethers";
import metamask from "../../assets/images/metamask.png";
import Header from "../Header";

import "./style.css";
import Action from "../Action";
import Loading from "../Loading";
import Button from "../Button";
import {
  CallWithERC2771Request,
  CallWithSyncFeeERC2771Request,
  CallWithSyncFeeRequest,
  GelatoRelay,
  SponsoredCallRequest,
  TransactionStatusResponse,
} from "@gelatonetwork/relay-sdk";
import { fetchStatusPoll, fetchStatusSocket } from "./task";

const GELATO_RELAY_API_KEY = "Z44jSJzqFfBGBrAJkIjg5K6jZZXI22xBEsgimC7aSBY_"; // YOUR SPONSOR KEY

const App = () => {
  // these could potentially be unified into one provider
  // provider will initially be the static JsonRpcProvider (read-only)
  // once a wallet is connected it will be set to the WalletProvider (can sign)

  const [ready, setReady] = useState(false);

  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<Chain>({ name: "", id: 0 });
  const [message, setMessage] = useState<Message>({
    header: "Loading",
    body: undefined,
    taskId: undefined,
  });
  const [max, setMax] = useState<boolean>(false);
  const [connectStatus, setConnectStatus] = useState<Status | null>({
    state: State.missing,
    message: "Loading",
  });

  const onConnect = async () => {
    console.log("connec");
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [
          {
            eth_accounts: {},
          },
        ],
      });
      window.location.reload();
    } catch (error) {}
  };

  const onDisconnect = async () => {
    setConnectStatus({
      state: State.failed,
      message: "Waiting for Disconnection",
    });

    await window.ethereum.request({
      method: "eth_requestAccounts",
      params: [
        {
          eth_accounts: {},
        },
      ],
    });
  };

  const onAction = async (action: number) => {
    setLoading(true);
    switch (action) {
      case 0:
        sponsoredCallERC2771();
        break;
      case 1:
        sponsoredCall();
        break;
      case 2:
        callWithSyncFeeERC2771();
        break;
      case 3:
        callWithSyncFee();
        break;
      case 4:
        sponsoredCallERC2771Permit();
        break;
      default:
        setLoading(false);
        break;
    }
  };

  function getTokenAbi() {
    return [
      "function nonces(address) view returns (uint256)",
      "function name() view returns (string)",
      "function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external",
      "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
    ];
  }
  const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  const doSign = async (
    signer: ethers.Signer,
    token: ethers.Contract,
    value: ethers.BigNumberish,
    owner: string,
    spender: string,
    deadline: number,
    chainId: number
  ): Promise<{ v: number; r: string; s: string } | null> => {
    const domain: ethers.TypedDataDomain = {
      name: await token.name(),
      version: "2",
      chainId: chainId,
      verifyingContract: USDC,
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const nonce = await token.nonces(owner);
    console.log("nonce", nonce.toString());

    const data = {
      owner,
      spender,
      value,
      nonce: nonce.toString(), // Ensure nonce is a string to match the expected type
      deadline,
    };

    // In Ethers.js v6, use `signTypedData` directly without underscore
    const signature = await signer.signTypedData(domain, types, data);
    const { v, r, s } = ethers.Signature.from(signature);

    // `splitSignature` remains the same, it's a utility function to split the signature
    return { v, r, s };
  };

  const sponsoredCallERC2771Permit = async () => {
    setChainId({ name: "Sepolia", id: 11155111 });
    const relay = new GelatoRelay();
    const amount = 1000000;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 50;
    const sender = "0x4803A57AeE38ACEf902db5871b66D7e5FE379A19";
    const bob = "0x02C48c159FDfc1fC18BA0323D67061dE1dEA329F";
    const abi = [
      "function send(address sender,address receiver,uint256 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s) external",
    ];

    const signer = await provider!.getSigner();
    const user = await signer.getAddress();

    const usdc = new ethers.Contract(USDC, getTokenAbi(), signer);

    // Generate the target payload
    const senderContract = new ethers.Contract(sender, abi, signer);

    const chainId = (await provider!.getNetwork()).chainId;
    console.log("chainId", chainId);
    const sig = (await doSign(
      signer,
      usdc,
      amount,
      signer.address, //owner
      sender, //spender
      deadline,
      Number(chainId)
    )) as ethers.Signature;
    const { v, r, s } = sig;

    const { data } = await senderContract.send.populateTransaction(
      signer.address,
      bob,
      amount,
      deadline,
      v,
      r,
      s
    );

    // Populate a relay request
    const request: CallWithERC2771Request = {
      chainId,
      target: sender,
      data: data as string,
      user: user as string,
    };

    relay.onTaskStatusUpdate((taskStatus: TransactionStatusResponse) => {
      console.log("Task status update", taskStatus);
      fetchStatusSocket(taskStatus, setMessage, setLoading);
    });

    const response = await relay.sponsoredCallERC2771(
      request,
      provider!,
      GELATO_RELAY_API_KEY as string
    );
    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
  };

  const sponsoredCallERC2771 = async () => {
    const relay = new GelatoRelay();
    const counter = "0x152742a6B2576059152466353915338b08df056d";
    const abi = ["function increment()"];

    const signer = await provider!.getSigner();
    const user = await signer.getAddress();

    const chainId = (await provider!.getNetwork()).chainId;

    // Generate the target payload
    const contract = new ethers.Contract(counter, abi, signer);
    const { data } = await contract.increment.populateTransaction();

    // Populate a relay request
    const request: CallWithERC2771Request = {
      chainId,
      target: counter,
      data: data as string,
      user: user as string,
    };

    relay.onTaskStatusUpdate((taskStatus: TransactionStatusResponse) => {
      console.log("Task status update", taskStatus);
      fetchStatusSocket(taskStatus, setMessage, setLoading);
    });

    const response = await relay.sponsoredCallERC2771(
      request,
      provider!,
      GELATO_RELAY_API_KEY as string
    );
    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
  };

  const sponsoredCall = async () => {
    const relay = new GelatoRelay();
    const counter = "0x152742a6B2576059152466353915338b08df056d";
    const abi = ["function increment()"];

    const chainId = (await provider!.getNetwork()).chainId;

    // Generate the target payload
    const contract = new ethers.Contract(counter, abi, signer);
    const { data } = await contract.increment.populateTransaction();

    // Populate a relay request
    const request: SponsoredCallRequest = {
      chainId,
      target: counter,
      data: data as string,
    };
    // relay.onTaskStatusUpdate((taskStatus: TransactionStatusResponse) => {
    //   console.log("Task status update", taskStatus);
    //   fetchStatusSocket(taskStatus, setMessage, setLoading);
    // });

    const response = await relay.sponsoredCall(
      request,
      GELATO_RELAY_API_KEY as string
    );

    const relayStatusWs = new WebSocket(
      "wss://api.gelato.digital/tasks/ws/status"
    );
    relayStatusWs.onopen = (event) => {
      relayStatusWs.send(
        JSON.stringify({
          action: "subscribe" as string,
          taskId: response.taskId,
        })
      );
      relayStatusWs.onmessage = (event) => {
        fetchStatusSocket(
          JSON.parse(event.data).payload,
          setMessage,
          setLoading
        );
      };
    };

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
  };

  const callWithSyncFee = async () => {
    const counter = "0x730615186326cF8f03E34a2B49ed0f43A38c0603";
    const abi = ["function increment()"];
    const signer = await provider!.getSigner();
    const relay = new GelatoRelay();

    const chainId = (await provider!.getNetwork()).chainId;

    // Generate the target payload
    const contract = new ethers.Contract(counter, abi, signer);
    const { data } = await contract.increment.populateTransaction();

    // address of the token to pay fees
    const feeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    // populate the relay SDK request body
    const request: CallWithSyncFeeRequest = {
      chainId,
      target: counter,
      data: data,
      feeToken: feeToken,
      isRelayContext: true,
    };

    const response = await relay.callWithSyncFee(request);

    // alert(`TaskId: https://relay.gelato.digital/tasks/status/${response.taskId}`)
    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatusPoll(response.taskId, setMessage, setLoading);
  };

  const callWithSyncFeeERC2771 = async () => {
    const relay = new GelatoRelay();
    const counter = "0x5dD1100f23278e0e27972eacb4F1B81D97D071B7";
    const abi = ["function increment()"];
    const signer = await provider!.getSigner();
    const user = await signer.getAddress();

    const chainId = (await provider!.getNetwork()).chainId;

    // Generate the target payload
    const contract = new ethers.Contract(counter, abi, signer);
    const { data } = await contract.increment.populateTransaction();

    // address of the token to pay fees
    const feeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    // populate the relay SDK request body
    const request: CallWithSyncFeeERC2771Request = {
      chainId,
      target: counter,
      data: data,
      user: user,
      feeToken: feeToken,
      isRelayContext: true,
    };

    const response = await relay.callWithSyncFeeERC2771(request, provider!);

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatusPoll(response.taskId, setMessage, setLoading);
  };

  const refresh = async (provider: ethers.BrowserProvider) => {
    setProvider(provider);

    const chain = await provider.getNetwork();
    setChainId({ name: chain.name, id: +chain.chainId.toString() });

    const addresses = await provider.listAccounts();

    if (addresses.length > 0) {
      const signer = await provider?.getSigner();
      const signerAddress = (await signer?.getAddress()) as string;
      setSignerAddress(signerAddress);
      setSigner(signer);
      setConnectStatus({
        state: State.success,
        message: "Connection Succed",
      });

      setLoading(false);
    } else {
      setLoading(false);
      setConnectStatus({ state: State.failed, message: "Connection Failed" });
    }

    //
    // console.log(signer);
  };

  const onUpdate = async (value: number, action: number) => {};

  useEffect(() => {
    (async () => {
      if (provider != null) {
        return;
      }
      if (window.ethereum == undefined) {
        setLoading(false);
      } else {
        const web3Provider = new ethers.BrowserProvider(window.ethereum);
        refresh(web3Provider);
      }
    })();
  }, []);

  return (
    <div className="App">
      <div className="container">
        <Header
          status={connectStatus}
          ready={ready}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          signerAddress={signerAddress}
        />
        {connectStatus?.state! == State.success && (
          <div>
            {loading && <Loading message={message} />}
            <main>
              <div className="flex">
                <p className="title">
                  Chain: {chainId.name} {chainId.id}{" "}
                </p>

                <div>
                  <div className="isDeployed">
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                      }}
                    >
                      <Action
                        ready={ready}
                        onClick={onAction}
                        onUpdate={onUpdate}
                        text="sponsoredCallERC2771"
                        action={0}
                        max={max}
                      />
                      <Action
                        ready={ready}
                        onClick={onAction}
                        onUpdate={onUpdate}
                        text="spondoredCall"
                        action={1}
                        max={max}
                      />
                      <Action
                        ready={ready}
                        onClick={onAction}
                        onUpdate={onUpdate}
                        text="callWithSyncFeeERC2771"
                        action={2}
                        max={max}
                      />
                      <Action
                        ready={ready}
                        onClick={onAction}
                        onUpdate={onUpdate}
                        text="callWithSyncFee"
                        action={3}
                        max={max}
                      />
                      <Action
                        ready={ready}
                        onClick={onAction}
                        onUpdate={onUpdate}
                        text="sponsoredCallERC2771Permit"
                        action={4}
                        max={max}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </main>
          </div>
        )}{" "}
        {connectStatus?.state! == State.missing && (
          <p style={{ textAlign: "center" }}>Metamask not Found</p>
        )}
        {(connectStatus?.state == State.pending ||
          connectStatus?.state == State.failed) && (
          <div style={{ textAlign: "center", marginTop: "20px" }}>
            <h3> Please connect your metamask</h3>
            <Button status={connectStatus} ready={ready} onClick={onConnect}>
              <img src={metamask} width={25} height={25} />{" "}
              <span style={{ position: "relative", top: "-6px" }}>
                Connect{" "}
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

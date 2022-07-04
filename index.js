const solana = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const serum = require('@project-serum/serum');
const anchor = require('@project-serum/anchor');
const serumUtils = require('@project-serum/anchor').web3;
const express = require('express');
const app = express();
const http = require('http');
const bodyParser = require('body-parser');
const cors = require('cors');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({}));

const server = http.createServer(app);
const blockchain = new solana.Connection(solana.clusterApiUrl('devnet'), 'confirmed');
const devnetMarketId = "DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY";
const mainnetMarketId = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

let master = undefined;
let washers = [];

let mint = undefined;
let masterSPL = undefined;

let market = undefined;

app.get('/generate', function(req, res)
{
    master = solana.Keypair.generate();
    res.send();
    res.end();
});

app.get('/generate-wash', function(req, res) 
{
    washers = [];
    for (let i = 0; i < 50; i++)
    {
        washers[i] = solana.Keypair.generate();
    }
    res.send();
    res.end();
});

app.get('/create-token', function (req, res)
{
    mint = await spl.createMint(
        blockchain,
        master,
        master.publicKey,
        master.publicKey,
        4
    );
    masterSPL = await spl.getOrCreateAssociatedTokenAccount(
        blockchain,
        master,
        mint,
        master.publicKey
    );
    await spl.mintTo(
        blockchain,
        master,
        mint,
        masterSPL.address,
        master.publicKey,
        10000000000
    );
    res.send();
    res.end();
});

app.get('/create-market', function(req, res)
{
    const requestQueue = solana.Keypair.generate();
    const eventQueue = solana.Keypair.generate();
    const bids = solana.Keypair.generate();
    const asks = solana.Keypair.generate();
    const baseVault = solana.Keypair.generate();
    const quoteVault = solana.Keypair.generate();
    const quoteDustThreshold = new anchor.BN(100);

    async function getVaultOwnerAndNonce(marketPublicKey, dexProgramId = mainnetMarketId) 
    {
        const nonce = new anchor.BN(0);
        while (nonce.toNumber() < 255) 
        {
            try
            {
                const vaultOwner = await solana.PublicKey.createProgramAddress(
                    [marketPublicKey.toBuffer(), nonce.toArrayLike(Buffer, le, 8)],
                    dexProgramId
                );
                return [vaultOwner, nonce];
            }
            catch (e)
            {
                nonce.iaddn(1);
            }
        }
    }

    const [vaultOwner, vaultSignerNonce] = await getVaultOwnerAndNonce(
        market.publicKey, //Fix This
        mainnetMarketId
    );
    const primaryTx = new solana.Transaction();
    primaryTx.add(
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: baseVault.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: spl.TOKEN_PROGRAM_ID,
        }),
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: quoteVault.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: spl.TOKEN_PROGRAM_ID,
        }),
        solana.SystemProgram.initializeAccount({
            account: baseVault.publicKey,
            mint: "",
            owner: vaultOwner,
        }),
        solana.SystemProgram.initializeAccount({
            account: quoteVault.publicKey,
            mint: "", //Solana tokens
            owner: vaultOwner,
        })
    );
    const secondaryTx = new solana.Transaction();
    secondaryTx.add(
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: market.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(
                serum.MARKET_STATE_LAYOUT_V3.span
            ),
            space: serum.MARKET_STATE_LAYOUT_V3.span,
            programId: mainnetMarketId,
        }),
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: requestQueue.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(5120 + 12),
            space: 5120 + 12,
            programId: mainnetMarketId,
        }),
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: eventQueue.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(262144 + 12),
            space: 262144 + 12,
            programId: mainnetMarketId,
        }),
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: bids.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: mainnetMarketId,
        }),
        solana.SystemProgram.createAccount({
            fromPubkey: master.publicKey,
            newAccountPubkey: asks.publicKey,
            lamports: await blockchain.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: mainnetMarketId,
        }),
        serum.DexInstructions.initializeMarket({
            market: market.publicKey,
            requestQueue: requestQueue.publicKey,
            eventQueue: eventQueue.publicKey,
            bids: bids.publicKey,
            asks: asks.publicKey,
            baseVault: baseVault.publicKey,
            quoteVault: quoteVault.publicKey,
            "baseMint",
            "quoteMint",
            baseLotSize: new anchor.BN(1),
            quoteLotSize: new anchor.BN(1),
            undefined, //feeRateBps
            vaultSignerNonce,
            quoteDustThreshold,
            programId: mainnetMarketId,
            authority: await serum.OpenOrdersPda.marketAuthority(
                market.PublicKey,
                undefined, //DEX_PID
                undefined, //proxyProgramId
            ),
            pruneAuthority: await undefined.pruneAuthority(
                market.PublicKey,
                undefined,
                undefined,
            ),
            crankAuthority: await undefined.consumeEventsAuthority(
                market.PublicKey,
                undefined,
                undefined,
            ),
        })
    );
    const transactions = [
        { transaction: primaryTx, signers: [baseVault, quoteVault] },
        {
            transaction: secondaryTx,
            signers: [market, requestQueue, eventQueue, bids, asks],
        },
    ];
    for (let tx of transactions)
    {
        await anchor.getProvider().send(tx.transaction, tx.signers);
    }
    const acc = await blockchain.getAccountInfo(market.publicKey);
    return [market.publicKey, vaultOwner];
});

app.post('/rug', function (req, res)
{
    let params = req.body.params;
    res.send();
    res.end();
})

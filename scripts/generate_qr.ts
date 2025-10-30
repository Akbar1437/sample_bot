import { promises as fs } from 'fs';
import path from 'path';
import * as QRCode from 'qrcode';

async function generateShopQR(shopCode: string, outputDir: string = 'qr_codes'): Promise<string> {
    const text = `/visit ${shopCode}`;
    const filename = `${shopCode}.png`;
    const outPath = path.join(outputDir, filename);

    try {
        // Ensure output directory exists
        await fs.mkdir(outputDir, { recursive: true });

        // Generate QR code with good size/margin for Telegram
        await QRCode.toFile(outPath, text, {
            width: 512,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#ffffff',
            },
        });

        return outPath;
    } catch (err) {
        console.error(`Error generating QR for ${shopCode}:`, err);
        throw err;
    }
}

// If script is run directly (not imported)
const shopCodes = process.argv.slice(2);
if (shopCodes.length === 0) {
    console.log('Usage: tsx scripts/generate_qr.ts SHOP123 [SHOP124 ...]');
    process.exit(1);
}

Promise.all(shopCodes.map(code => generateShopQR(code)))
    .then(files => {
        console.log('Generated QR codes:');
        files.forEach(f => console.log(`- ${f}`));
    })
    .catch(err => {
        console.error('Failed to generate QR codes:', err);
        process.exit(1);
    }); export { generateShopQR };

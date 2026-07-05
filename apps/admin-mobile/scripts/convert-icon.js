import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const svgPath = 'D:\\aivastra\\webtool\\apps\\admin-mobile\\assets\\favicon.svg';
const _svg = fs.readFileSync(svgPath);

// Android mipmap sizes (actual icon size, not pixel density)
const DENSITIES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const mipmapBase = 'D:\\aivastra\\webtool\\apps\\admin-mobile\\android\\app\\src\\main\\res';

const svgBuffer = fs.readFileSync(svgPath);

async function generateIcons() {
  // Generate density-specific PNGs for legacy icons
  for (const [density, size] of Object.entries(DENSITIES)) {
    const png = await sharp(svgBuffer).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(mipmapBase, `mipmap-${density}`, 'ic_launcher.png'), png);
    fs.writeFileSync(path.join(mipmapBase, `mipmap-${density}`, 'ic_launcher_round.png'), png);
    console.log(`Generated mipmap-${density} (${size}x${size})`);

    // Also replace splashscreen_logo
    const logoPath = path.join(mipmapBase, `drawable-${density}`, 'splashscreen_logo.png');
    if (fs.existsSync(logoPath)) {
      fs.writeFileSync(logoPath, png);
      console.log(`  Updated splashscreen_logo for ${density}`);
    }
  }

  // Generate a 1024x1024 version for adaptive icon foreground
  const foreground1024 = await sharp(svgBuffer).resize(1024, 1024).png().toBuffer();
  // For the foreground, we need a drawable that has proper padding
  // Adaptive icons typically have a 25% safe zone, so we create a padded version
  const _padded1024 = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(svgBuffer).resize(614, 614).png().toBuffer(), // ~60% size for safe zone
        top: 205,
        left: 205,
      },
    ])
    .png()
    .toBuffer();

  // Check drawable-hdpi for splashscreen
  const drawableBase = path.join(mipmapBase, 'drawable');
  if (!fs.existsSync(drawableBase)) {
    fs.mkdirSync(drawableBase, { recursive: true });
  }

  // Also put a copy in assets for reference
  const assetsOutput = 'D:\\aivastra\\webtool\\apps\\admin-mobile\\assets\\icon.png';
  fs.writeFileSync(assetsOutput, foreground1024);
  console.log(`\nGenerated ${assetsOutput} (1024x1024)`);

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);

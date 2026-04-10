const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const cron = require('node-cron');
const ytSearch = require('yt-search');
const { exec } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { uploadToInstagram } = require('./instagram');
require('dotenv').config();

const TEMP_DIR = os.tmpdir();
const DB_FILE = path.join(__dirname, 'downloaded.json');

// Initialize directories and databases
fs.ensureDirSync(TEMP_DIR);
if (!fs.existsSync(DB_FILE)) {
    fs.writeJsonSync(DB_FILE, []);
}

const KEYWORDS = [
    "cool gadgets India",
    "cheap useful products India",
    "street market gadgets India",
    "trending gadgets India",
    "viral products India",
    "amazon finds India",
    "flipkart gadgets under 500",
    "budget gadgets India",
    "useful daily items India",
    "smart gadgets India",
    "home gadgets India"
];

// Load AI using Gemini (if key provided), else fail gracefully
const GEMINI_API_KEY = "AIzaSyC9NPpk8KWD22L2nuvaLAR5dbX-G7_sr4w";
let aiModel = null;
if (GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // Using gemini-pro which has highest availability across all versions
    aiModel = genAI.getGenerativeModel({ model: 'gemini-pro' }); 
} else {
    console.warn("⚠️ No GEMINI_API_KEY found. Using fallback title generation.");
}

function getDownloadedVideos() {
    return fs.readJsonSync(DB_FILE, { throws: false }) || [];
}

function markAsDownloaded(videoData) {
    const data = getDownloadedVideos();
    data.push(videoData);
    fs.writeJsonSync(DB_FILE, data, { spaces: 2 });
}

async function generateSEOData(originalTitle, keyword) {
    if (aiModel) {
        try {
            const prompt = `Act as an expert YouTube SEO specialist.
I am uploading a short video about a cheap/useful gadget from India.
The original video title is: "${originalTitle}".
The target keyword is: "${keyword}".

Please generate:
1. A catchy, clickable, and SEO-optimized YouTube Shorts title (under 60 characters).
2. A list of 5-8 relevant hashtags.

Format your response exactly like this:
TITLE: <your title>
HASHTAGS: <your hashtags separated by spaces>`;

            const result = await aiModel.generateContent(prompt);
            const responseText = result.response.text();
            
            const titleMatch = responseText.match(/TITLE:\s*(.+)/i);
            const tagsMatch = responseText.match(/HASHTAGS:\s*(.+)/i);

            return {
                seoTitle: titleMatch ? titleMatch[1].trim() : originalTitle,
                hashtags: tagsMatch ? tagsMatch[1].trim() : '#gadgets #india #trending'
            };
        } catch (error) {
            console.error("AI Error (Likely invalid GEMINI_API_KEY):", error.message);
        }
    }

    // Fallback if no AI or AI fails
    const cleanTitle = originalTitle.replace(/[#@]/g, '').slice(0, 40);
    return {
        seoTitle: `Amazing Gadget! ${cleanTitle} 🔥`,
        hashtags: '#gadgets #india #usefulproducts #trending #amazonfinds'
    };
}

async function downloadVideo(url, outputPath) {
    return new Promise((resolve, reject) => {
        const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        const cookieFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : "";
        
        const command = `yt-dlp --user-agent "${userAgent}" ${cookieFlag} -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best" --ffmpeg-location "${ffmpegStatic}" --js-runtimes node --merge-output-format mp4 -o "${outputPath}" "${url}"`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlp download failed: ${stderr || error.message}`);
                return reject(error);
            }
            console.log("✅ Download & Merge Complete.");
            resolve(true);
        });
    });
}

async function processVideoWithFFmpeg(inputPath, outputPath) {
    const logoPath = path.join(__dirname, 'assets', 'indianmarketlogopng.png');
    
    return new Promise((resolve, reject) => {
        console.log(`🎬  Preparing Filter Graph (Target: 1080x1920)...`);
        
        const filterGraph = [
            `color=c=white:s=1080x1920:r=30[bg]`,
            `[1:v]scale=400:-2,format=rgba[logo]`,
            `[0:v]fps=30,scale=960:1344:force_original_aspect_ratio=decrease,pad=960:1344:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[vid]`,
            // Sharp rounded corners at 30fps
            `color=c=black:s=960x1344:r=30,format=gray,drawbox=x=6:y=6:w=iw-12:h=ih-12:color=white:t=fill,boxblur=15,lutyuv=y='if(gt(val,128),255,0)'[mask]`,
            `[vid][mask]alphamerge[rounded_vid]`,
            `[bg][logo]overlay=(W-w)/2:40[bg1]`, // Logo closer to the top edge (y=40)
            `[bg1][rounded_vid]overlay=(W-w)/2:340,format=yuv420p[vout]` // Video shifted up accordingly (y=340)
        ].join(';');

        // IMPORTANT: -shortest is required because our white background source is infinite.
        // It tells FFmpeg to stop rendering as soon as the shortest input (the main video) ends.
        const command = `"${ffmpegStatic}" -y -i "${inputPath}" -i "${logoPath}" -filter_complex "${filterGraph}" -map "[vout]" -map 0:a? -shortest -c:v libx264 -profile:v high -level 4.1 -preset ultrafast -crf 23 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart -threads 0 -c:a aac -b:a 128k -ar 44100 "${outputPath}"`;
        
        console.log("🛠️  Applying 'The Indian Market' Visual Theme...");
        console.log("⏳  Rendering (this may take up to 60s for high-res videos)...");

        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error("❌ FFmpeg failed during rendering!");
                console.error("--- FFmpeg Error Output ---");
                console.error(stderr);
                console.error("---------------------------");
                return reject(error);
            }
            console.log("✨  Rendering Finished!");
            console.log(`✅  Video Styled and Saved: ${path.basename(outputPath)}`);
            resolve(true);
        });
    });
}

async function runScraper() {
    console.log(`\n[${new Date().toISOString()}] Starting daily scraper job...`);
    const downloadedIds = getDownloadedVideos().map(v => v.id);

    try {
        let targetVideo = null;
        let keywordUsed = '';

        for (let attempts = 0; attempts < 5; attempts++) {
            const keyword = KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
            const searchQuery = `${keyword} #shorts`;
            console.log(`Searching for: ${searchQuery} (Attempt ${attempts + 1}/5)`);

            try {
                const r = await ytSearch(searchQuery);
                const videos = r.videos;
                
                const validShorts = videos.filter(v => 
                    v.seconds > 0 && v.seconds <= 61 && 
                    !downloadedIds.includes(v.videoId)
                );

                if (validShorts.length > 0) {
                    targetVideo = validShorts[Math.floor(Math.random() * Math.min(validShorts.length, 3))]; 
                    keywordUsed = keyword;
                    break;
                } else {
                    console.log(`  ⏩ No new shorts for: ${keyword}. Retrying...`);
                }
            } catch (error) {
                console.error("  ❌ Search error:", error.message);
            }
        }

        if (!targetVideo) {
            console.log("❌ Exhausted retries. No new valid shorts found for any keywords.");
            return;
        }

        console.log(`Found target video: ${targetVideo.title} (ID: ${targetVideo.videoId}, Duration: ${targetVideo.timestamp})`);
        
        const seoData = await generateSEOData(targetVideo.title, keywordUsed);
        
        const outputFilename = `${targetVideo.videoId}.mp4`;
        const finalOutputPath = path.join(TEMP_DIR, outputFilename);
        const rawVideoPath = path.join(TEMP_DIR, `raw_${targetVideo.videoId}.mp4`);
        
        console.log(`Downloading raw video...`);
        await downloadVideo(targetVideo.url, rawVideoPath);

        console.log('Applying Custom Editing & Styles (Bypassing Duplicate Filter)...');
        await processVideoWithFFmpeg(rawVideoPath, finalOutputPath);

        fs.unlinkSync(rawVideoPath);

        const metadata = {
            id: targetVideo.videoId,
            originalTitle: targetVideo.title,
            originalUrl: targetVideo.url,
            keywordUsed: keywordUsed,
            seoTitle: seoData.seoTitle,
            hashtags: seoData.hashtags,
            downloadDate: new Date().toISOString(),
            filename: outputFilename
        };

        markAsDownloaded(metadata);
        
        const detailsPath = path.join(TEMP_DIR, `${targetVideo.videoId}_details.txt`);
        fs.writeFileSync(detailsPath, `Original Title: ${targetVideo.title}\nSEO Title: ${seoData.seoTitle}\nHashtags: ${seoData.hashtags}\nURL: ${targetVideo.url}\n`);

        console.log(`Successfully processed: ${targetVideo.videoId}`);

        // --- Instagram Upload Workflow ---
        const igCaption = `${seoData.seoTitle}\n\n${seoData.hashtags}\n\nVideo Credit: ${targetVideo.author.name}`;
        console.log(`🚀 Triggering Instagram upload (Crediting: ${targetVideo.author.name})...`);
        
        try {
            await uploadToInstagram(finalOutputPath, igCaption);
            console.log('✅ Instagram upload completed successfully');
        } catch (igError) {
            console.error('❌ Instagram upload failed:', igError.message);
        } finally {
            // ALWAYS clean up local files to keep the computer clean
            console.log('🗑️  Permanently cleaning up local storage...');
            if (fs.existsSync(finalOutputPath)) fs.unlinkSync(finalOutputPath);
            if (fs.existsSync(detailsPath)) fs.unlinkSync(detailsPath);
            console.log('✨  Local storage cleared.');
        }

    } catch (error) {
        console.error("Error during scraping:", error);
    }
}

// Schedule for 9:30 AM, 12:00 PM, 4:30 PM, 7:00 PM
// Cron syntax: [minute] [hour] [day of month] [month] [day of week]
const SCHEDULES = ['30 9 * * *', '0 12 * * *', '30 16 * * *', '0 19 * * *'];

SCHEDULES.forEach(s => {
    cron.schedule(s, () => {
        console.log(`⏰ Scheduled Task Triggered: ${s}`);
        runScraper();
    });
});

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--run-now')) {
        console.log('Starting execution immediately...');
        runScraper().then(() => {
            console.log('Run completed. Exiting.');
            process.exit(0);
        });
    } else {
        // Schedule cron jobs for automatic runs
        
        SCHEDULES.forEach(s => {
            cron.schedule(s, () => {
                console.log(`⏰ Scheduled Task Triggered: ${s}`);
                runScraper();
            });
        });
        console.log('Cron schedules set. Bot will run at configured times.');
    }
}

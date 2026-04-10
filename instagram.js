const fs = require('fs-extra');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Uploads file temporarily to catbox.moe (Primary)
async function uploadToCatbox(filePath) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(filePath));

    const response = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    
    const fileUrl = response.data.trim();
    if (!fileUrl || !fileUrl.startsWith('http')) {
        throw new Error(`Invalid URL returned from Catbox: "${fileUrl}"`);
    }
    return fileUrl;
}

// Backup: Uploads to tmpfiles.org if Catbox fails
async function uploadToTmpFiles(filePath) {
    console.log(`☁️  Switching to Backup Host (tmpfiles.org)...`);
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    if (response.data && response.data.status === 'success') {
        // Convert https://tmpfiles.org/XXXXX to https://tmpfiles.org/dl/XXXXX for direct video access
        const uploadUrl = response.data.data.url;
        const directUrl = uploadUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
        console.log(`✅  Backup URL generated: ${directUrl}`);
        return directUrl;
    }
    throw new Error('tmpfiles.org upload failed or returned invalid data');
}

async function uploadToInstagram(videoPath, caption) {
    const igUserId = process.env.IG_USER_ID;
    const igAccessToken = process.env.IG_ACCESS_TOKEN;

    if (!igUserId || !igAccessToken) {
        console.error('⚠️ IG_USER_ID or IG_ACCESS_TOKEN is missing in .env. Skipping Instagram upload.');
        return;
    }

    try {
        let publicVideoUrl;
        
        // Try Primary Host (Catbox)
        try {
            console.log(`☁️  Uploading ${path.basename(videoPath)} to primary store (Catbox)...`);
            publicVideoUrl = await uploadToCatbox(videoPath);
            console.log(`✅  Primary URL generated: ${publicVideoUrl}`);
        } catch (primaryError) {
            console.warn(`⚠️  Primary host (Catbox) failed: ${primaryError.message}`);
            // Try Backup Host (tmpfiles)
            publicVideoUrl = await uploadToTmpFiles(videoPath);
        }

        // Step 2: Initialize Reel creation
        console.log('📱 Initializing Instagram Reel upload...');
        const createMediaUrl = `https://graph.facebook.com/v20.0/${igUserId}/media`;
        const createMediaBody = {
            media_type: 'REELS',
            video_url: publicVideoUrl,
            caption: caption,
            access_token: igAccessToken
        };

        let creationResponse;
        try {
            creationResponse = await axios.post(createMediaUrl, createMediaBody);
        } catch (postError) {
            console.error('❌ Failed to initialize Instagram upload:', postError.response?.data || postError.message);
            throw postError;
        }

        const creationId = creationResponse.data.id;
        console.log(`⏳ Reel upload initialized. Container ID: ${creationId}`);

        // Step 3: Poll for upload status
        const statusUrl = `https://graph.facebook.com/v20.0/${creationId}?fields=status_code&access_token=${igAccessToken}`;
        let status = 'IN_PROGRESS';
        let retries = 0;
        const maxRetries = 60; // 5 mins total

        console.log('⏳ Waiting for Instagram to process the video...');
        while (status !== 'FINISHED' && retries < maxRetries) {
            await delay(5000); // 5 seconds
            
            const statusResponse = await axios.get(statusUrl);
            status = statusResponse.data.status_code;
            
            if (status === 'ERROR') {
                throw new Error('Instagram failed to process the video.');
            }
            
            retries++;
        }

        if (status !== 'FINISHED') {
            throw new Error('Timed out waiting for Instagram to process the reel.');
        }

        // Step 4: Publish Reel
        console.log('✨ Video processed. Publishing Reel...');
        const publishUrl = `https://graph.facebook.com/v20.0/${igUserId}/media_publish`;
        const publishBody = {
            creation_id: creationId,
            access_token: igAccessToken
        };

        const publishResponse = await axios.post(publishUrl, publishBody);
        
        console.log(`✅ Reel published successfully! IG Media ID: ${publishResponse.data.id}`);
        return publishResponse.data.id;

    } catch (error) {
        console.error('❌ Error during Instagram upload workflow:', error.message);
        if (error.response?.data) {
            console.error('Meta API Error Details:', error.response.data);
        }
        throw error; // Re-throw so index.js knows it failed
    }
}

module.exports = { uploadToInstagram };


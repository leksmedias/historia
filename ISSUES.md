# Known Issues

## Vertex AI Imagen 4 — Quota Limit (1 req/min)

**Status:** Pending quota increase request to Google Sales  
**Impact:** Image generation rate-limited to 1 image per minute, making concurrent users impossible  
**Project ID:** `project-f3847793-8610-4a16-945`  
**Region:** `europe-west4`  
**Model:** `imagen-4.0-fast-generate-001`  
**Current quota:** 1 request/minute  
**Requested quota:** 60 requests/minute  

### Effect on the product

A typical 30-scene project takes 30 minutes for image generation alone. With multiple concurrent users they queue behind each other, making the platform unusable at even small scale.

The code currently retries on 429 with 10s → 20s → 30s backoff (4 attempts), which helps with brief spikes but cannot overcome a hard 1/min quota.

### Resolution

Send the message below to Google Cloud Sales via:  
**console.cloud.google.com → Support → Contact Sales**

---

### Message to send to Google Sales

**Subject: Quota Increase Request — Vertex AI Imagen 4 for SaaS Platform (Testing Phase)**

Hi Google Cloud Sales Team,

I'm reaching out to request a quota increase for **Vertex AI Imagen 4** (`imagen-4.0-fast-generate-001`) on our project (`project-f3847793-8610-4a16-945`) in the `europe-west4` region.

**About our product:**
We are building **Historia**, an AI-powered cinematic documentary generation platform (SaaS). The platform allows multiple users to transform historical scripts into full documentary videos — AI-generated images, professional narration, and video export — all automated through our pipeline.

**Current situation:**
We are currently in the **testing phase**, onboarding our first batch of users. Each user session generates multiple images per project (typically 20–60 images per documentary). With multiple concurrent users, our current quota of **1 request per minute** creates significant bottlenecks that make the product unusable at even a small user scale.

**What we need:**
We are requesting an increase to at least **60 requests per minute** to support concurrent users during our testing phase, with the expectation of scaling further as we move toward public launch.

We are committed to the Google Cloud ecosystem and are using Vertex AI as the core image generation engine for our platform. We are happy to discuss our roadmap, usage projections, or any additional information needed to support this request.

**Project details:**
- Project ID: `project-f3847793-8610-4a16-945`
- Region: `europe-west4`
- Model: `imagen-4.0-fast-generate-001`
- Current quota: 1 request/minute
- Requested quota: 60 requests/minute

Thank you for your time. Looking forward to hearing from you.

Best regards,
[Your Name]

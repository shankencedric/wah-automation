# WAH Patient Record Automation

A Node.js and Playwright automation tool designed to process patient records in the WAH portal. It automatically reads a patient's Initial Diagnosis, cross-references it with a custom dictionary, inputs the corresponding Final Diagnosis, and seamlessly ends the visit.

## ✨ Features
* **Smart Diagnosis Mapping:** Maps Initial Diagnoses to specific Final Diagnosis codes using a customizable dictionary.
* **Resilient Rate-Limit Handling:** Automatically catches "Too Many Attempts" errors and restarts properly.
* **Pagination Support:** Automatically navigates through pages of patients.
* **Safe Restart & Memory:** If the script crashes or hits a rate limit, it preserves the skipped patient list and total counts to prevent duplicate processing.
* **Detailed Summary:** Generates a comprehensive JSON summary report upon completion.
---

## ⚙️ Prerequisite
* **Node.js** (v18 or higher recommended)

---

## 🚀 Setup & Installation

1. **Install Dependencies:**
   Open your terminal in the project folder and run:
   ```bash
   npm install
   ```

2. **Install Playwright Browsers:**
   Download the Chromium browser required by Playwright:
   ```bash
   npx playwright install chromium
   ```

---

## 📁 Configuration Files

Before running the script, you must configure three files in the root directory.

### 1. `.env`
Contains your private credentials and target portal data. Create a file named `.env` and add the following:
```env
URL="https://cavite.wah.com"
EMAIL="your_email@example.com"
PASSWORD="your_password"
NAME="Last Name, First Name MI."
WAH_UUID="your_wah_uuid"
```
> The UUID is going to need manual HTML fiddling in the website to get. Contact any contributor for help with this.

### 2. `diagnoses.json`
Your dictionary mapping Initial Diagnoses (exact text) to Final Diagnosis Codes (codes only).
```json
{
  "Diabetes Mellitus": "E11",
  "Pregnant": "Z32",
  "URTI": "J39.9",
  // ...
}
```

### 3. `config.json`
Controls the behavior, speed, and starting points of the automation.
```json
{
    "startAtPage": 0,
    "startAtRow": 0,
    "attemptReloadOnRateLimitError": true,
    "reloadAttempts": 5,
    "debug_mode": true,
    "debug_endedVisitTargetCount": 5
}
```
* **`startAtPage`**: The pagination offset to begin at (0 = first page).
* **`startAtRow`**: The index of the patient row to start at on the offsetted page (1 = first row).
* **`attemptReloadOnRateLimitError`**: Set to `true` to enable automatic page reloading if the server returns a "Too Many Attempts" error.
* **`debug_mode`**: Set to `true` to watch the browser work (headed mode) and slow down interactions. Set to `false` for faster, invisible (headless) execution.
* **`debug_endedVisitTargetCount`**: The script will safely exit after successfully ending visit this many patients (useful for testing).

---

## 💻 Usage

To start the automation, open the project in terminal and run:
```bash
node app.js
```

### Final Summary
When the script finishes (or exhausts retries), it will output a final JSON report showing total visits ended, total patients skipped, execution time, and a list of skipped patient names so you can review them manually.
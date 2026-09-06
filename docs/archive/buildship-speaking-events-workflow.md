# BuildShip Workflow: Speaking Events Image Upload

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 15, 2026
**Purpose:** Create a BuildShip workflow to upload event images to Firebase Cloud Storage and store
download URLs in Firestore

---

## Overview

This workflow enables you to:

1. Upload event images via a web form
2. Automatically store them in Firebase Cloud Storage (`speakerevents/` folder)
3. Save the full download URL to Firestore `eventImageUrl` field
4. Maintain proper file naming and organization

---

## Architecture

```
BuildShip Workflow (Web Form)
    ↓
Upload Image (Firebase Storage)
    ↓
Get Download URL
    ↓
Update Firestore speakerevents Document
    ↓
Display in Speaking Engagements Widget
```

---

## Step-by-Step Setup

### Step 1: Create BuildShip Workflow

1. Go to [BuildShip Dashboard](https://app.buildship.com/)
2. Create a new workflow named: `Upload Speaking Event Image`
3. Set trigger type: **HTTP Request (REST API)**
4. HTTP Method: **POST**

### Step 2: Configure Input Schema

In the HTTP trigger, define the request body schema:

```json
{
  "type": "object",
  "properties": {
    "eventId": {
      "type": "string",
      "description": "Firestore document ID (from speakerevents collection)"
    },
    "eventName": {
      "type": "string",
      "description": "Name of the speaking event"
    },
    "imageFile": {
      "type": "string",
      "description": "Base64-encoded image data or URL"
    },
    "imageFileName": {
      "type": "string",
      "description": "Original filename (e.g., 'event-photo.png')"
    }
  },
  "required": ["eventId", "eventName", "imageFile", "imageFileName"]
}
```

### Step 3: Add Firebase Upload Node

1. **Add Node** → Search for **Firebase Storage** → **Upload File**
2. Configure:
   - **Service Account Key**: Select your HCW Firebase project
   - **Bucket**: `hybridcloudworks-61e8d.appspot.com`
   - **File Path**:
     ```
     speakerevents/{{ eventId }}/eventImageUrl/{{ imageFileName }}
     ```
   - **File Content**: (Connect to imageFile input)
   - **Content Type**: `image/png` or auto-detect from filename

3. **Output Variable Name**: `uploadResult`

### Step 4: Add Get Download URL Node

1. **Add Node** → Search for **Firebase Storage** → **Get Download URL**
2. Configure:
   - **Service Account Key**: Same Firebase project
   - **Bucket**: `hybridcloudworks-61e8d.appspot.com`
   - **File Path**:
     ```
     speakerevents/{{ eventId }}/eventImageUrl/{{ imageFileName }}
     ```

3. **Output Variable Name**: `downloadUrl`

### Step 5: Add Firestore Update Node

1. **Add Node** → Search for **Firebase Firestore** → **Update Document**
2. Configure:
   - **Service Account Key**: Same Firebase project
   - **Collection**: `speakerevents`
   - **Document ID**: `{{ eventId }}`
   - **Data to Update**:
     ```json
     {
       "eventImageUrl": "{{ downloadUrl }}"
     }
     ```

   ```

   ```

3. **Output Variable Name**: `updateResult`

### Step 6: Add Response Node

1. **Add Node** → **Return Response**
2. Configure response:
   ```json
   {
     "success": true,
     "message": "Image uploaded successfully",
     "downloadUrl": "{{ downloadUrl }}",
     "eventId": "{{ eventId }}"
   }
   ```

### Step 7: Add Error Handling

1. Add error handlers for each Firebase node
2. Return appropriate error messages:
   ```json
   {
     "success": false,
     "error": "Upload failed: {{ errorMessage }}"
   }
   ```

---

## Update Firestore Storage Rules

Your current `storage.rules` needs to allow BuildShip uploads. Update it:

```firebase-rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // ========================================================================
    // Speaking Events - BuildShip Uploads
    // ========================================================================

    match /speakerevents/{eventId}/{allPaths=**} {
      allow read: if true;  // Public read
      allow write: if request.auth == null;  // Service account (BuildShip) can write
    }

    // ... rest of existing rules ...
  }
}
```

Then deploy:

```bash
firebase deploy --only storage
```

---

## Integration with Rowy

Once the BuildShip workflow is set up:

### In Rowy:

1. Open the `speakerevents` table
2. In the `eventImageUrl` column:
   - **Field Type**: URL (or File)
   - **Add Action Button**: Create custom action
   - Link to your BuildShip workflow endpoint

3. Or use a **Custom Component** to embed an upload button

### Example Rowy Action Config:

```javascript
// Custom action in Rowy
const uploadImage = async (row) => {
  const file = await selectFile(); // File picker

  const formData = new FormData();
  formData.append('eventId', row.id);
  formData.append('eventName', row.name);
  formData.append('imageFile', file);
  formData.append('imageFileName', file.name);

  const response = await fetch('YOUR_BUILDSHIP_WEBHOOK_URL', {
    method: 'POST',
    body: JSON.stringify({
      eventId: row.id,
      eventName: row.name,
      imageFile: await fileToBase64(file),
      imageFileName: file.name,
    }),
  });

  return response.json();
};
```

---

## Manual Upload Alternative

If you prefer not to use BuildShip, use Firebase Console directly:

1. **Firebase Console** → **Storage**
2. Create folder structure manually:
   ```
   speakerevents/
   └── [eventId]/
       └── eventImageUrl/
           └── image.png
   ```
3. Upload file
4. Click file → Copy download URL (with auth token)
5. Paste into Firestore `eventImageUrl` field in Rowy

---

## Testing the Workflow

### Using cURL:

```bash
curl -X POST https://your-buildship-webhook-url \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "tprVKGxm9EWGP766l9tx",
    "eventName": "Business Applications LATAM",
    "imageFile": "data:image/png;base64,iVBORw0KGgo...",
    "imageFileName": "latam-event.png"
  }'
```

### Expected Response:

```json
{
  "success": true,
  "message": "Image uploaded successfully",
  "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/speakerevents%2FtprVKGxm9EWGP766l9tx%2FeventImageUrl%2Flatam-event.png?alt=media&token=...",
  "eventId": "tprVKGxm9EWGP766l9tx"
}
```

---

## Frontend Integration (Optional)

To add direct upload from your Speaking Engagements page:

```javascript
const uploadEventImage = async (eventId, file) => {
  const formData = new FormData();
  formData.append('eventId', eventId);
  formData.append('imageFile', await fileToBase64(file));
  formData.append('imageFileName', file.name);

  const response = await fetch(
    process.env.REACT_APP_BUILDSHIP_WEBHOOK_URL,
    { method: 'POST', body: JSON.stringify({...}) }
  );

  if (response.ok) {
    // Refresh the speaking engagements widget
    // Firestore listener will auto-update
    console.log('Image uploaded successfully');
  }
};
```

---

## Troubleshooting

| Issue                                    | Solution                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| **"Permission denied" error**            | Check `storage.rules` allows service account writes to `speakerevents/*`       |
| **Download URL not saving to Firestore** | Verify Firestore document ID matches exactly in the Update Document node       |
| **Image shows blank in Rowy**            | Ensure `eventImageUrl` field is type **URL** and contains full HTTPS link      |
| **BuildShip webhook returns 404**        | Check webhook URL is copied correctly from BuildShip dashboard                 |
| **File uploads but URL is invalid**      | Verify filename doesn't contain special characters; sanitize in BuildShip node |

---

## Security Considerations

1. **Limit file size**: Set max 5-10MB in BuildShip and storage rules
2. **Validate image types**: Only allow `image/png`, `image/jpeg`, `image/webp`
3. **Use service account**: BuildShip uses service account (not user auth)
4. **Public read access**: Images in `speakerevents/` are publicly readable (OK for event photos)
5. **CORS**: If uploading from frontend, configure CORS in Firebase

---

## Next Steps

1. Create the BuildShip workflow following steps above
2. Deploy updated `storage.rules`
3. Test with sample event image
4. Integrate upload button into Rowy (optional)
5. Document in team wiki how to add new speaking events with images

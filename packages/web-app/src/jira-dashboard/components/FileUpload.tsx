import React, { useState } from 'react';
import jiraApi from '../services/api';

interface FileUploadProps {
  onUploadComplete: (uploadId: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUploadComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('Please select a CSV file');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setError('');
    }
  };

  const cancelUpload = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    setUploading(false);
    setProgress('');
    setProgressPercent(0);
    setCurrentUploadId(null);
  };

  const pollUploadStatus = async (uploadId: string) => {
    try {
      const status = await jiraApi.getUploadStatus(uploadId);

      if (status.status === 'processing') {
        setProgress(`Processing CSV... ${status.progress}%`);
        setProgressPercent(status.progress);
      } else if (status.status === 'completed') {
        setProgress('Processing complete!');
        setProgressPercent(100);
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
        setTimeout(() => {
          onUploadComplete(uploadId);
        }, 1000);
      } else if (status.status === 'failed') {
        setError(status.errorMessage || 'Processing failed');
        setUploading(false);
        setProgressPercent(0);
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setProgress('Getting upload URL...');
    setProgressPercent(0);
    setError('');

    try {
      // Step 1: Get presigned URL
      const { uploadId, presignedUrl } = await jiraApi.getUploadUrl(file.name, description);
      setCurrentUploadId(uploadId);

      // Step 2: Upload file to S3
      setProgress('Uploading file to S3...');
      setProgressPercent(10);
      await jiraApi.uploadCsvFile(presignedUrl, file);

      // Step 3: Start polling for status
      setProgress('Upload complete! Processing CSV...');
      setProgressPercent(20);

      // Poll every 2 seconds
      const interval = setInterval(() => {
        pollUploadStatus(uploadId);
      }, 2000);
      setPollingInterval(interval);

      // Initial status check
      await pollUploadStatus(uploadId);

      // Reset file selection
      setFile(null);
      setDescription('');
      if (document.getElementById('file-input')) {
        (document.getElementById('file-input') as HTMLInputElement).value = '';
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
      setProgressPercent(0);
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Upload Jira CSV Export</h2>

      <div style={styles.formGroup}>
        <label style={styles.label}>CSV File</label>
        <input
          id="file-input"
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          disabled={uploading}
          style={styles.fileInput}
        />
        {file && <p style={styles.fileName}>Selected: {file.name}</p>}
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Description (Optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g., December 2024 Export"
          disabled={uploading}
          style={styles.textInput}
        />
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        style={{
          ...styles.button,
          ...((!file || uploading) && styles.buttonDisabled),
        }}
      >
        {uploading ? 'Uploading...' : 'Upload CSV'}
      </button>

      {uploading && (
        <button
          onClick={cancelUpload}
          style={styles.cancelButton}
        >
          Cancel Upload
        </button>
      )}

      {progress && (
        <div style={styles.progressContainer}>
          <p style={styles.progress}>{progress}</p>
          {progressPercent > 0 && (
            <div style={styles.progressBarContainer}>
              <div style={{...styles.progressBar, width: `${progressPercent}%`}} />
            </div>
          )}
        </div>
      )}
      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.instructions}>
        <h3 style={styles.instructionsTitle}>Instructions:</h3>
        <ol style={styles.instructionsList}>
          <li>Export your Jira project data as CSV</li>
          <li>Select the CSV file above</li>
          <li>Add an optional description</li>
          <li>Click "Upload CSV" to start processing</li>
          <li>Once processed, view your dashboard metrics</li>
        </ol>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: '#333',
  },
  formGroup: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontWeight: '500',
    color: '#555',
  },
  fileInput: {
    display: 'block',
    width: '100%',
    padding: '10px',
    border: '2px dashed #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  textInput: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  fileName: {
    marginTop: '8px',
    fontSize: '14px',
    color: '#666',
  },
  button: {
    width: '100%',
    padding: '12px 24px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
    cursor: 'not-allowed',
  },
  cancelButton: {
    width: '100%',
    padding: '10px 24px',
    marginTop: '12px',
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  progressContainer: {
    marginTop: '16px',
  },
  progress: {
    padding: '12px',
    backgroundColor: '#e7f3ff',
    color: '#0066cc',
    borderRadius: '4px',
    textAlign: 'center',
    marginBottom: '8px',
  },
  progressBarContainer: {
    width: '100%',
    height: '24px',
    backgroundColor: '#e9ecef',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#0066cc',
    transition: 'width 0.3s ease-in-out',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
  },
  error: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#ffe7e7',
    color: '#cc0000',
    borderRadius: '4px',
    textAlign: 'center',
  },
  instructions: {
    marginTop: '30px',
    padding: '20px',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
  },
  instructionsTitle: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '12px',
    color: '#333',
  },
  instructionsList: {
    marginLeft: '20px',
    color: '#666',
    lineHeight: '1.8',
  },
};

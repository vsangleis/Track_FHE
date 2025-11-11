import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface AssetData {
  id: string;
  name: string;
  encryptedGPS: string;
  status: number;
  category: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<AssetData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAssetData, setNewAssetData] = useState({ name: "", gps: "", category: "electronics", status: "0" });
  const [selectedAsset, setSelectedAsset] = useState<AssetData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, active: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const assetsList: AssetData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          assetsList.push({
            id: businessId,
            name: businessData.name,
            encryptedGPS: businessId,
            status: Number(businessData.publicValue2) || 0,
            category: getCategoryFromValue(Number(businessData.publicValue1)),
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAssets(assetsList);
      updateStats(assetsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (assetsList: AssetData[]) => {
    setStats({
      total: assetsList.length,
      verified: assetsList.filter(a => a.isVerified).length,
      active: assetsList.filter(a => a.status === 0).length
    });
  };

  const getCategoryFromValue = (value: number): string => {
    const categories = ["electronics", "jewelry", "art", "documents", "other"];
    return categories[value % categories.length] || "other";
  };

  const getCategoryValue = (category: string): number => {
    const categories: { [key: string]: number } = {
      "electronics": 0, "jewelry": 1, "art": 2, "documents": 3, "other": 4
    };
    return categories[category] || 4;
  };

  const createAsset = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAsset(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating asset with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const gpsValue = parseInt(newAssetData.gps) || 0;
      const businessId = `asset-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, gpsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAssetData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        getCategoryValue(newAssetData.category),
        parseInt(newAssetData.status),
        "Confidential Asset Tracking"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Asset created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAssetData({ name: "", gps: "", category: "electronics", status: "0" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAsset(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "GPS data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying GPS decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "GPS data decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "GPS data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `System available: ${available}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredAssets = assets.filter(asset =>
    asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    asset.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedAssets = filteredAssets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredAssets.length / itemsPerPage);

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <h3>Total Assets</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
        </div>
        <div className="stat-card neon-blue">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified GPS</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
        </div>
        <div className="stat-card neon-pink">
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <h3>Active Tracking</h3>
            <div className="stat-value">{stats.active}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>GPS Encryption</h4>
            <p>Asset coordinates encrypted with FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Secure Storage</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Query</h4>
            <p>Authorized parties can query without decryption</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Secure Verification</h4>
            <p>Offline decryption with on-chain proof</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1 className="logo-text">🔐 AssetGuard FHE</h1>
            <p className="logo-subtitle">Confidential Asset Tracking</p>
          </div>
          <div className="wallet-section">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-screen">
          <div className="connection-content">
            <div className="secure-icon">🛡️</div>
            <h2>Secure Asset Tracking</h2>
            <p>Connect your wallet to start tracking assets with fully homomorphic encryption</p>
            <div className="feature-list">
              <div className="feature-item">🔒 GPS Data Encryption</div>
              <div className="feature-item">🔄 Homomorphic Queries</div>
              <div className="feature-item">📡 Real-time Tracking</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-loader"></div>
        <h3>Initializing FHE System</h3>
        <p>Setting up confidential computing environment...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="fhe-loader"></div>
        <h3>Loading Asset Data</h3>
        <p>Decrypting secure records...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1 className="logo-text">🔐 AssetGuard FHE</h1>
          <p className="logo-subtitle">Confidential Asset Tracking</p>
        </div>
        
        <div className="header-actions">
          <button className="action-btn availability" onClick={checkAvailability}>
            Check System
          </button>
          <button className="action-btn primary" onClick={() => setShowCreateModal(true)}>
            + New Asset
          </button>
          <div className="wallet-section">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>Asset Tracking Dashboard</h2>
            <button className="refresh-btn" onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
            </button>
          </div>
          
          {renderStats()}
          
          <div className="fhe-info-panel">
            <h3>FHE 🔐 Encryption Process</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="assets-section">
          <div className="assets-header">
            <h2>Tracked Assets</h2>
            <div className="assets-controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search assets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <span className="search-icon">🔍</span>
              </div>
              <select className="filter-select">
                <option>All Categories</option>
                <option>Electronics</option>
                <option>Jewelry</option>
                <option>Art</option>
                <option>Documents</option>
              </select>
            </div>
          </div>

          <div className="assets-list">
            {paginatedAssets.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <h3>No Assets Found</h3>
                <p>Start tracking your first confidential asset</p>
                <button className="action-btn primary" onClick={() => setShowCreateModal(true)}>
                  + Add First Asset
                </button>
              </div>
            ) : (
              paginatedAssets.map((asset, index) => (
                <div 
                  key={asset.id}
                  className={`asset-card ${selectedAsset?.id === asset.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAsset(asset)}
                >
                  <div className="asset-header">
                    <h3 className="asset-name">{asset.name}</h3>
                    <span className={`status-badge status-${asset.status}`}>
                      {['Active', 'In Transit', 'Alert'][asset.status] || 'Unknown'}
                    </span>
                  </div>
                  
                  <div className="asset-details">
                    <div className="detail-item">
                      <span className="label">Category:</span>
                      <span className="value">{asset.category}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">GPS Data:</span>
                      <span className="value">
                        {asset.isVerified ? 
                          `Verified: ${asset.decryptedValue}` : 
                          '🔒 Encrypted'
                        }
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Created:</span>
                      <span className="value">{new Date(asset.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  <div className="asset-actions">
                    <button 
                      className={`decrypt-btn ${asset.isVerified ? 'verified' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        decryptData(asset.id);
                      }}
                      disabled={fheIsDecrypting}
                    >
                      {asset.isVerified ? '✅ Verified' : '🔓 Decrypt GPS'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                className="page-btn"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const page = Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i;
                return page <= totalPages ? (
                  <button
                    key={page}
                    className={`page-btn ${currentPage === page ? 'active' : ''}`}
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </button>
                ) : null;
              })}
              
              <button 
                className="page-btn"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </main>

      {showCreateModal && (
        <CreateAssetModal
          onSubmit={createAsset}
          onClose={() => setShowCreateModal(false)}
          creating={creatingAsset}
          assetData={newAssetData}
          setAssetData={setNewAssetData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedAsset && (
        <AssetDetailModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onDecrypt={() => decryptData(selectedAsset.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateAssetModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  assetData: any;
  setAssetData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, assetData, setAssetData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setAssetData({ ...assetData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Track New Asset</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Tracking</strong>
              <p>GPS coordinates will be encrypted using fully homomorphic encryption</p>
            </div>
          </div>

          <div className="form-group">
            <label>Asset Name *</label>
            <input
              type="text"
              name="name"
              value={assetData.name}
              onChange={handleChange}
              placeholder="Enter asset name..."
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>GPS Coordinate (Integer) *</label>
            <input
              type="number"
              name="gps"
              value={assetData.gps}
              onChange={handleChange}
              placeholder="Enter GPS value..."
              className="form-input"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select
                name="category"
                value={assetData.category}
                onChange={handleChange}
                className="form-select"
              >
                <option value="electronics">Electronics</option>
                <option value="jewelry">Jewelry</option>
                <option value="art">Art</option>
                <option value="documents">Documents</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="form-group">
              <label>Status</label>
              <select
                name="status"
                value={assetData.status}
                onChange={handleChange}
                className="form-select"
              >
                <option value="0">Active</option>
                <option value="1">In Transit</option>
                <option value="2">Alert</option>
              </select>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary"
            onClick={onSubmit}
            disabled={creating || isEncrypting || !assetData.name || !assetData.gps}
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Asset"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AssetDetailModal: React.FC<{
  asset: AssetData;
  onClose: () => void;
  onDecrypt: () => void;
  isDecrypting: boolean;
}> = ({ asset, onClose, onDecrypt, isDecrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <div className="modal-header">
          <h2>Asset Details</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="asset-info-grid">
            <div className="info-item">
              <label>Asset Name</label>
              <span>{asset.name}</span>
            </div>
            <div className="info-item">
              <label>Category</label>
              <span className="category-tag">{asset.category}</span>
            </div>
            <div className="info-item">
              <label>Status</label>
              <span className={`status-tag status-${asset.status}`}>
                {['Active', 'In Transit', 'Alert'][asset.status] || 'Unknown'}
              </span>
            </div>
            <div className="info-item">
              <label>Created</label>
              <span>{new Date(asset.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-item">
              <label>Creator</label>
              <span className="address">{asset.creator.substring(0, 8)}...{asset.creator.substring(36)}</span>
            </div>
          </div>

          <div className="gps-section">
            <h3>GPS Data Security</h3>
            <div className="gps-status">
              <div className="gps-indicator">
                <span className="indicator-icon">
                  {asset.isVerified ? '✅' : '🔒'}
                </span>
                <div>
                  <strong>GPS Coordinate</strong>
                  <p>{asset.isVerified ? 
                    `Decrypted: ${asset.decryptedValue} (Verified on-chain)` : 
                    'Encrypted with FHE technology'
                  }</p>
                </div>
              </div>
              
              <button 
                className={`decrypt-btn large ${asset.isVerified ? 'verified' : ''}`}
                onClick={onDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? 'Decrypting...' : 
                 asset.isVerified ? 'GPS Verified' : 'Decrypt GPS Data'}
              </button>
            </div>
          </div>

          <div className="security-info">
            <h4>🔐 FHE Security Features</h4>
            <ul>
              <li>GPS data encrypted using fully homomorphic encryption</li>
              <li>Authorized parties can query location without decryption</li>
              <li>On-chain verification of decryption proofs</li>
              <li>Protection against location tracking attacks</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          {!asset.isVerified && (
            <button className="btn-primary" onClick={onDecrypt} disabled={isDecrypting}>
              {isDecrypting ? 'Verifying...' : 'Verify on-chain'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AssetTracker is ZamaEthereumConfig {
    struct Asset {
        string assetId;
        euint32 encryptedLocation;
        uint256 timestamp;
        address owner;
        bool isVerified;
        uint32 decryptedLocation;
    }

    mapping(string => Asset) public assets;
    string[] public assetIds;

    event AssetRegistered(string indexed assetId, address indexed owner);
    event LocationVerified(string indexed assetId, uint32 decryptedLocation);

    constructor() ZamaEthereumConfig() {}

    function registerAsset(
        string calldata assetId,
        externalEuint32 encryptedLocation,
        bytes calldata locationProof,
        string calldata description
    ) external {
        require(bytes(assets[assetId].assetId).length == 0, "Asset already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocation, locationProof)), "Invalid encrypted location");

        assets[assetId] = Asset({
            assetId: assetId,
            encryptedLocation: FHE.fromExternal(encryptedLocation, locationProof),
            timestamp: block.timestamp,
            owner: msg.sender,
            isVerified: false,
            decryptedLocation: 0
        });

        FHE.allowThis(assets[assetId].encryptedLocation);
        FHE.makePubliclyDecryptable(assets[assetId].encryptedLocation);
        assetIds.push(assetId);

        emit AssetRegistered(assetId, msg.sender);
    }

    function verifyLocation(
        string calldata assetId,
        bytes memory abiEncodedClearLocation,
        bytes memory decryptionProof
    ) external {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        require(!assets[assetId].isVerified, "Location already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(assets[assetId].encryptedLocation);

        FHE.checkSignatures(cts, abiEncodedClearLocation, decryptionProof);

        uint32 decodedLocation = abi.decode(abiEncodedClearLocation, (uint32));
        assets[assetId].decryptedLocation = decodedLocation;
        assets[assetId].isVerified = true;

        emit LocationVerified(assetId, decodedLocation);
    }

    function getEncryptedLocation(string calldata assetId) external view returns (euint32) {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        return assets[assetId].encryptedLocation;
    }

    function getAssetDetails(string calldata assetId) external view returns (
        string memory assetId_,
        uint256 timestamp,
        address owner,
        bool isVerified,
        uint32 decryptedLocation
    ) {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        Asset storage asset = assets[assetId];

        return (
            asset.assetId,
            asset.timestamp,
            asset.owner,
            asset.isVerified,
            asset.decryptedLocation
        );
    }

    function getAllAssetIds() external view returns (string[] memory) {
        return assetIds;
    }

    function updateAssetLocation(
        string calldata assetId,
        externalEuint32 newEncryptedLocation,
        bytes calldata locationProof
    ) external {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        require(msg.sender == assets[assetId].owner, "Only owner can update location");
        require(FHE.isInitialized(FHE.fromExternal(newEncryptedLocation, locationProof)), "Invalid encrypted location");

        assets[assetId].encryptedLocation = FHE.fromExternal(newEncryptedLocation, locationProof);
        assets[assetId].timestamp = block.timestamp;
        assets[assetId].isVerified = false;

        FHE.allowThis(assets[assetId].encryptedLocation);
        FHE.makePubliclyDecryptable(assets[assetId].encryptedLocation);
    }

    function transferOwnership(
        string calldata assetId,
        address newOwner
    ) external {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        require(msg.sender == assets[assetId].owner, "Only owner can transfer ownership");
        require(newOwner != address(0), "Invalid new owner address");

        assets[assetId].owner = newOwner;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


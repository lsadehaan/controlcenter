package identity

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

type Identity struct {
	AgentID    string
	PublicKey  string
	PrivateKey *rsa.PrivateKey
}

func Generate(privateKeyPath, publicKeyPath string) (*Identity, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("failed to generate private key: %w", err)
	}

	privateKeyPEM := &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}

	privateKeyFile, err := os.OpenFile(privateKeyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return nil, fmt.Errorf("failed to create private key file: %w", err)
	}
	defer privateKeyFile.Close()

	if err := pem.Encode(privateKeyFile, privateKeyPEM); err != nil {
		return nil, fmt.Errorf("failed to write private key: %w", err)
	}

	publicKey, err := ssh.NewPublicKey(&privateKey.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH public key: %w", err)
	}

	publicKeyStr := string(ssh.MarshalAuthorizedKey(publicKey))
	
	if err := os.WriteFile(publicKeyPath, []byte(publicKeyStr), 0644); err != nil {
		return nil, fmt.Errorf("failed to write public key: %w", err)
	}

	return &Identity{
		AgentID:    uuid.New().String(),
		PublicKey:  publicKeyStr,
		PrivateKey: privateKey,
	}, nil
}

func Load(privateKeyPath, publicKeyPath string) (*Identity, error) {
	privateKeyData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	block, _ := pem.Decode(privateKeyData)
	if block == nil {
		return nil, fmt.Errorf("failed to parse PEM block")
	}

	privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	publicKeyData, err := os.ReadFile(publicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read public key: %w", err)
	}

	return &Identity{
		PublicKey:  string(publicKeyData),
		PrivateKey: privateKey,
	}, nil
}

func EnsureIdentity(privateKeyPath, publicKeyPath string, agentID string) (*Identity, error) {
	if _, err := os.Stat(privateKeyPath); os.IsNotExist(err) {
		identity, err := Generate(privateKeyPath, publicKeyPath)
		if err != nil {
			return nil, err
		}
		if agentID == "" {
			agentID = identity.AgentID
		}
		identity.AgentID = agentID
		return identity, nil
	}

	identity, err := Load(privateKeyPath, publicKeyPath)
	if err != nil {
		return nil, err
	}
	
	if agentID != "" {
		identity.AgentID = agentID
	}
	
	return identity, nil
}
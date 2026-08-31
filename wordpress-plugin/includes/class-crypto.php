<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Encrypts secrets the plugin must persist (the full API key — see
 * class-connection-settings.php) using a key derived from this WordPress
 * install's own AUTH_KEY salt (wp-config.php, not the database), so a raw
 * database dump does not trivially expose the plaintext. This is the
 * standard pattern WordPress plugins use to persist secrets without an
 * external KMS (comparable to how payment gateway plugins store secret
 * keys in wp_options). See
 * docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md.
 */
class Aivastra_Crypto
{
    private const CIPHER = 'aes-256-cbc';

    private static function derive_key(): string
    {
        // wp_salt('auth') is defined in wp-config.php, never stored in the
        // database — hashed to a fixed-length key because openssl_encrypt
        // requires exactly 32 bytes for AES-256.
        return hash('sha256', wp_salt('auth'), true);
    }

    public static function encrypt(string $plaintext): string
    {
        $key = self::derive_key();
        $ivLength = openssl_cipher_iv_length(self::CIPHER);
        $iv = openssl_random_pseudo_bytes($ivLength);
        $ciphertext = openssl_encrypt($plaintext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        if ($ciphertext === false) {
            throw new RuntimeException('Failed to encrypt value.');
        }
        // iv:ciphertext, both base64 — a single string wp_options can store as-is.
        return base64_encode($iv) . ':' . base64_encode($ciphertext);
    }

    public static function decrypt(string $encoded): ?string
    {
        $parts = explode(':', $encoded, 2);
        if (count($parts) !== 2) {
            return null;
        }
        [$ivB64, $ciphertextB64] = $parts;
        $iv = base64_decode($ivB64, true);
        $ciphertext = base64_decode($ciphertextB64, true);
        if ($iv === false || $ciphertext === false) {
            return null;
        }
        $key = self::derive_key();
        $plaintext = openssl_decrypt($ciphertext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        return $plaintext === false ? null : $plaintext;
    }
}

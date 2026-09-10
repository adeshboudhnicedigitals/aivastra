<?php
declare(strict_types=1);

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase;

final class CryptoTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Monkey\setUp();
        Functions\when('wp_salt')->justReturn('a-fixed-test-salt-value-not-a-real-secret');
    }

    protected function tearDown(): void
    {
        Monkey\tearDown();
        parent::tearDown();
    }

    public function test_round_trips_a_value(): void
    {
        $encrypted = Aivastra_Crypto::encrypt('sk_live_full_example_1234567890');
        $this->assertNotSame('sk_live_full_example_1234567890', $encrypted);
        $this->assertSame('sk_live_full_example_1234567890', Aivastra_Crypto::decrypt($encrypted));
    }

    public function test_two_encryptions_of_the_same_value_differ(): void
    {
        $first = Aivastra_Crypto::encrypt('sk_live_full_example_1234567890');
        $second = Aivastra_Crypto::encrypt('sk_live_full_example_1234567890');
        $this->assertNotSame($first, $second, 'IVs must be random per call');
    }

    public function test_decrypt_returns_null_for_malformed_input(): void
    {
        $this->assertNull(Aivastra_Crypto::decrypt('not-a-valid-encoded-value'));
    }
}

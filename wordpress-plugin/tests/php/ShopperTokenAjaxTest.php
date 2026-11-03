<?php
declare(strict_types=1);

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase;

final class ShopperTokenAjaxTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Monkey\setUp();
        Functions\when('wp_json_encode')->alias('json_encode');
    }

    protected function tearDown(): void
    {
        Monkey\tearDown();
        parent::tearDown();
    }

    public function test_token_is_a_signed_payload_the_api_can_verify(): void
    {
        $token = Aivastra_Shopper_Token_Ajax::sign_token('sec_abc', 'u:7', true, 1900000000);
        [$payload, $signature] = explode('.', $token);

        $claims = json_decode((string) base64_decode(strtr($payload, '-_', '+/')), true);
        $this->assertSame(['sid' => 'u:7', 'lg' => 1, 'exp' => 1900000000], $claims);

        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, 'sec_abc', true)), '+/', '-_'), '=');
        $this->assertSame($expected, $signature);
    }

    public function test_a_guest_token_carries_lg_zero(): void
    {
        $token = Aivastra_Shopper_Token_Ajax::sign_token('sec_abc', 'g:abc', false, 1900000000);
        [$payload] = explode('.', $token);
        $claims = json_decode((string) base64_decode(strtr($payload, '-_', '+/')), true);
        $this->assertSame(0, $claims['lg']);
    }

    public function test_base64url_has_no_padding_or_url_unsafe_characters(): void
    {
        $encoded = Aivastra_Shopper_Token_Ajax::base64url("\xfb\xff\xfe?>");
        $this->assertDoesNotMatchRegularExpression('/[+\/=]/', $encoded);
    }
}

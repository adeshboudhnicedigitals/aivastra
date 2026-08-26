<?php
declare(strict_types=1);

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase;

final class ConnectionServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Monkey\setUp();
    }

    protected function tearDown(): void
    {
        Monkey\tearDown();
        parent::tearDown();
    }

    public function test_successful_connect_stores_widget_key_and_snapshot_not_the_full_key(): void
    {
        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/me',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_full')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode(['companyName' => 'Acme Co', 'credits' => 500]));
        Functions\expect('current_time')->once()->with('mysql')->andReturn('2026-08-26 00:00:00');

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('set_widget_key_and_snapshot')
            ->once()
            ->with('sk_live_widget', 'Acme Co', '2026-08-26 00:00:00');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->connect('sk_live_full', 'sk_live_widget');

        $this->assertTrue($result['ok']);
    }

    public function test_network_error_does_not_touch_settings(): void
    {
        Functions\expect('wp_remote_get')->once()->andReturn(new WP_Error('http_request_failed'));
        Functions\expect('is_wp_error')->once()->andReturn(true);

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldNotReceive('set_widget_key_and_snapshot');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->connect('sk_live_full', 'sk_live_widget');

        $this->assertFalse($result['ok']);
        $this->assertNotEmpty($result['error']);
    }

    public function test_non_200_response_does_not_touch_settings(): void
    {
        Functions\expect('wp_remote_get')->once()->andReturn(['response' => ['code' => 401]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(401);

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldNotReceive('set_widget_key_and_snapshot');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->connect('sk_live_full', 'sk_live_widget');

        $this->assertFalse($result['ok']);
    }
}

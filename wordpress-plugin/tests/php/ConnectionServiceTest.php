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

    public function test_successful_connect_stores_widget_key_full_key_and_snapshot(): void
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
            ->with('sk_live_widget', 'sk_live_full', 'Acme Co', 500, '2026-08-26 00:00:00');

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

    public function test_successful_refresh_updates_credits_using_the_stored_widget_key(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn('sk_live_widget');

        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/balance',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_widget')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode(['credits' => 750]));
        Functions\expect('current_time')->once()->with('mysql')->andReturn('2026-08-27 00:00:00');

        $settings->shouldReceive('update_credits')
            ->once()
            ->with(750, '2026-08-27 00:00:00');
        $settings->shouldNotReceive('set_widget_key_and_snapshot');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->refresh();

        $this->assertTrue($result['ok']);
    }

    public function test_refresh_without_a_stored_widget_key_does_not_call_the_api(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn(null);
        $settings->shouldNotReceive('update_credits');

        Functions\expect('wp_remote_get')->never();

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->refresh();

        $this->assertFalse($result['ok']);
    }

    public function test_refresh_network_error_does_not_touch_settings(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn('sk_live_widget');
        $settings->shouldNotReceive('update_credits');

        Functions\expect('wp_remote_get')->once()->andReturn(new WP_Error('http_request_failed'));
        Functions\expect('is_wp_error')->once()->andReturn(true);

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->refresh();

        $this->assertFalse($result['ok']);
        $this->assertNotEmpty($result['error']);
    }

    public function test_refresh_non_200_response_does_not_touch_settings(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn('sk_live_widget');
        $settings->shouldNotReceive('update_credits');

        Functions\expect('wp_remote_get')->once()->andReturn(['response' => ['code' => 401]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(401);

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->refresh();

        $this->assertFalse($result['ok']);
    }

    public function test_list_categories_returns_the_categories_using_the_widget_key(): void
    {
        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/categories',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_widget')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode(['categories' => [['slug' => 'general', 'name' => 'General']]]));

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_categories('sk_live_widget');

        $this->assertTrue($result['ok']);
        $this->assertSame([['slug' => 'general', 'name' => 'General']], $result['categories']);
    }

    public function test_list_categories_returns_not_ok_on_network_error(): void
    {
        Functions\expect('wp_remote_get')->once()->andReturn(new WP_Error('http_request_failed'));
        Functions\expect('is_wp_error')->once()->andReturn(true);

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_categories('sk_live_widget');

        $this->assertFalse($result['ok']);
        $this->assertSame([], $result['categories']);
    }

    public function test_list_categories_returns_not_ok_when_the_widget_key_is_rejected(): void
    {
        Functions\expect('wp_remote_get')->once()->andReturn(['response' => ['code' => 401]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(401);

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_categories('sk_live_widget');

        $this->assertFalse($result['ok']);
        $this->assertSame([], $result['categories']);
    }

    public function test_list_plans_returns_the_plans_using_the_widget_key(): void
    {
        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/plans',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_widget')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode([
                'plans' => [['slug' => 'basic', 'name' => 'Basic', 'priceInr' => 25000, 'credits' => 10000]],
            ]));

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_plans('sk_live_widget');

        $this->assertTrue($result['ok']);
        $this->assertSame(
            [['slug' => 'basic', 'name' => 'Basic', 'priceInr' => 25000, 'credits' => 10000]],
            $result['plans']
        );
    }

    public function test_list_plans_returns_not_ok_on_network_error(): void
    {
        Functions\expect('wp_remote_get')->once()->andReturn(new WP_Error('http_request_failed'));
        Functions\expect('is_wp_error')->once()->andReturn(true);

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_plans('sk_live_widget');

        $this->assertFalse($result['ok']);
        $this->assertSame([], $result['plans']);
    }

    public function test_create_order_without_a_stored_full_key_does_not_call_the_api(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn(null);

        Functions\expect('wp_remote_post')->never();

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->create_order('basic');

        $this->assertFalse($result['ok']);
        $this->assertSame('not_connected', $result['error']);
    }

    public function test_create_order_posts_the_plan_slug_using_the_stored_full_key(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_json_encode')->once()->with(['planSlug' => 'basic'])->andReturn('{"planSlug":"basic"}');
        Functions\expect('wp_remote_post')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/payments/orders',
                Mockery::on(
                    fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_full'
                        && $args['body'] === '{"planSlug":"basic"}'
                )
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode([
                'orderId' => 'order_abc',
                'amount' => 2950000,
                'currency' => 'INR',
                'keyId' => 'rzp_test_key',
                'credits' => 10000,
                'label' => 'Basic',
            ]));

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->create_order('basic');

        $this->assertTrue($result['ok']);
        $this->assertSame('order_abc', $result['orderId']);
        $this->assertSame('rzp_test_key', $result['keyId']);
    }

    public function test_create_order_returns_not_ok_when_the_full_key_is_rejected(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_json_encode')->once()->andReturn('{"planSlug":"basic"}');
        Functions\expect('wp_remote_post')->once()->andReturn(['response' => ['code' => 403]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(403);

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->create_order('basic');

        $this->assertFalse($result['ok']);
    }

    public function test_verify_payment_updates_the_stored_balance_on_success(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn('sk_live_widget');

        $payment = [
            'razorpayOrderId' => 'order_abc',
            'razorpayPaymentId' => 'pay_abc',
            'razorpaySignature' => 'sig_abc',
        ];

        Functions\expect('wp_json_encode')->once()->with($payment)->andReturn(json_encode($payment));
        Functions\expect('wp_remote_post')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/payments/verify',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_widget')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode(['ok' => true, 'alreadyCredited' => false, 'balance' => 10340]));
        Functions\expect('current_time')->once()->with('mysql')->andReturn('2026-08-31 00:00:00');

        $settings->shouldReceive('update_credits')->once()->with(10340, '2026-08-31 00:00:00');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->verify_payment($payment);

        $this->assertTrue($result['ok']);
        $this->assertSame(10340, $result['balance']);
    }

    public function test_get_analytics_without_a_stored_full_key_does_not_call_the_api(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn(null);

        Functions\expect('wp_remote_get')->never();

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->get_analytics();

        $this->assertFalse($result['ok']);
        $this->assertSame('not_connected', $result['error']);
    }

    public function test_get_analytics_returns_cards_daily_and_products_using_the_stored_full_key(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/analytics',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_full')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode([
                'cards' => ['tryOns' => 12, 'uniqueShoppers' => 5, 'addedToCart' => 3, 'addToCartRate' => 0.25],
                'daily' => [['day' => '2026-08-30', 'tryOns' => 2]],
                'products' => [['productId' => 7, 'tryOns' => 4, 'uniqueShoppers' => 3, 'addedToCart' => 1, 'addToCartRate' => 0.25]],
            ]));

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->get_analytics();

        $this->assertTrue($result['ok']);
        $this->assertSame(12, $result['cards']['tryOns']);
        $this->assertSame([['day' => '2026-08-30', 'tryOns' => 2]], $result['daily']);
        $this->assertSame(7, $result['products'][0]['productId']);
    }

    public function test_get_analytics_returns_not_ok_on_network_error(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_remote_get')->once()->andReturn(new WP_Error('http_request_failed'));
        Functions\expect('is_wp_error')->once()->andReturn(true);

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->get_analytics();

        $this->assertFalse($result['ok']);
    }

    public function test_get_analytics_returns_not_ok_when_the_full_key_is_rejected(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_remote_get')->once()->andReturn(['response' => ['code' => 403]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(403);

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->get_analytics();

        $this->assertFalse($result['ok']);
    }

    public function test_verify_payment_without_a_stored_widget_key_does_not_call_the_api(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn(null);

        Functions\expect('wp_remote_post')->never();

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->verify_payment([
            'razorpayOrderId' => 'order_abc',
            'razorpayPaymentId' => 'pay_abc',
            'razorpaySignature' => 'sig_abc',
        ]);

        $this->assertFalse($result['ok']);
        $this->assertSame('not_connected', $result['error']);
    }
}

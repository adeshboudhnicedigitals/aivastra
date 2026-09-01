<?php
declare(strict_types=1);

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase;

final class ConnectionSettingsTest extends TestCase
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

    public function test_get_widget_key_reads_from_the_options_row(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['widget_key' => 'sk_live_abc']);

        $settings = new Aivastra_Connection_Settings();
        $this->assertSame('sk_live_abc', $settings->get_widget_key());
    }

    public function test_get_widget_key_returns_null_when_unset(): void
    {
        Functions\expect('get_option')->once()->andReturn([]);
        $settings = new Aivastra_Connection_Settings();
        $this->assertNull($settings->get_widget_key());
    }

    public function test_set_widget_key_and_snapshot_persists_the_encrypted_full_key_too(): void
    {
        Functions\when('wp_salt')->justReturn('a-fixed-test-salt-value-not-a-real-secret');

        Functions\expect('update_option')
            ->once()
            ->with(
                'aivastra_tryon_settings',
                Mockery::on(function ($saved) {
                    return $saved['widget_key'] === 'sk_live_new'
                        && $saved['company_name'] === 'Acme Co'
                        && $saved['credits'] === 500
                        && $saved['credits_as_of'] === '2026-08-26 00:00:00'
                        && Aivastra_Crypto::decrypt($saved['full_key']) === 'sk_live_full_original';
                })
            )
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->set_widget_key_and_snapshot(
            'sk_live_new',
            'sk_live_full_original',
            'Acme Co',
            500,
            '2026-08-26 00:00:00'
        );

        $this->addToAssertionCount(1);
    }

    public function test_get_credits_reads_from_the_options_row(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['credits' => 500]);

        $settings = new Aivastra_Connection_Settings();
        $this->assertSame(500, $settings->get_credits());
    }

    public function test_get_credits_returns_null_when_unset(): void
    {
        Functions\expect('get_option')->once()->andReturn([]);
        $settings = new Aivastra_Connection_Settings();
        $this->assertNull($settings->get_credits());
    }

    public function test_update_credits_merges_balance_and_timestamp_without_touching_widget_key_company_name_or_category_map(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn([
                'widget_key' => 'sk_live_widget',
                'company_name' => 'Acme Co',
                'category_map' => [12 => 'saree'],
            ]);
        Functions\expect('update_option')
            ->once()
            ->with('aivastra_tryon_settings', [
                'widget_key' => 'sk_live_widget',
                'company_name' => 'Acme Co',
                'category_map' => [12 => 'saree'],
                'credits' => 750,
                'credits_as_of' => '2026-08-27 00:00:00',
            ])
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->update_credits(750, '2026-08-27 00:00:00');

        $this->addToAssertionCount(1);
    }

    public function test_clear_deletes_the_entire_options_row(): void
    {
        Functions\expect('delete_option')
            ->once()
            ->with('aivastra_tryon_settings')
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->clear();

        $this->addToAssertionCount(1);
    }

    public function test_get_category_map_reads_from_the_options_row(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['category_map' => [12 => 'saree']]);

        $settings = new Aivastra_Connection_Settings();
        $this->assertSame([12 => 'saree'], $settings->get_category_map());
    }

    public function test_get_category_map_returns_empty_array_when_unset(): void
    {
        Functions\expect('get_option')->once()->andReturn([]);
        $settings = new Aivastra_Connection_Settings();
        $this->assertSame([], $settings->get_category_map());
    }

    public function test_set_category_map_merges_into_the_existing_options_row(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['widget_key' => 'sk_live_widget']);
        Functions\expect('update_option')
            ->once()
            ->with('aivastra_tryon_settings', [
                'widget_key' => 'sk_live_widget',
                'category_map' => [12 => 'saree'],
            ])
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->set_category_map([12 => 'saree']);

        $this->addToAssertionCount(1);
    }

    public function test_get_full_key_decrypts_the_stored_value(): void
    {
        Functions\when('wp_salt')->justReturn('a-fixed-test-salt-value-not-a-real-secret');
        $encrypted = Aivastra_Crypto::encrypt('sk_live_full_original');

        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['full_key' => $encrypted]);

        $settings = new Aivastra_Connection_Settings();
        $this->assertSame('sk_live_full_original', $settings->get_full_key());
    }

    public function test_get_full_key_returns_null_when_unset(): void
    {
        Functions\expect('get_option')->once()->andReturn([]);
        $settings = new Aivastra_Connection_Settings();
        $this->assertNull($settings->get_full_key());
    }

    public function test_get_widget_customization_returns_defaults_when_never_saved(): void
    {
        Functions\expect('get_option')->once()->andReturn([]);
        $settings = new Aivastra_Connection_Settings();
        $this->assertSame(Aivastra_Widget_Customization::defaults(), $settings->get_widget_customization());
    }

    public function test_get_widget_customization_merges_a_partial_stored_row_with_defaults(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['widget_customization' => ['accentColor' => '#ff0000', 'share' => false]]);

        $settings = new Aivastra_Connection_Settings();
        $customization = $settings->get_widget_customization();

        $this->assertSame('#ff0000', $customization['accentColor']);
        $this->assertFalse($customization['share']);
        $this->assertTrue($customization['addToCart']);
        $this->assertNull($customization['heading']);
    }

    public function test_set_widget_customization_merges_into_the_existing_options_row(): void
    {
        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['widget_key' => 'sk_live_widget']);
        Functions\expect('update_option')
            ->once()
            ->with('aivastra_tryon_settings', [
                'widget_key' => 'sk_live_widget',
                'widget_customization' => ['accentColor' => '#ff0000'],
            ])
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->set_widget_customization(['accentColor' => '#ff0000']);

        $this->addToAssertionCount(1);
    }
}

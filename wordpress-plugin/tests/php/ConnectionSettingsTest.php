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

    public function test_set_widget_key_and_snapshot_persists_both_in_one_write(): void
    {
        Functions\expect('update_option')
            ->once()
            ->with('aivastra_tryon_settings', [
                'widget_key' => 'sk_live_new',
                'company_name' => 'Acme Co',
                'credits_as_of' => '2026-08-26 00:00:00',
            ])
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->set_widget_key_and_snapshot('sk_live_new', 'Acme Co', '2026-08-26 00:00:00');

        // The assertion is the Functions\expect(...)->once()->with(...) above,
        // verified by Monkey\tearDown() — this satisfies PHPUnit's "risky test"
        // check, which otherwise flags a test with no explicit assertion.
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

    public function test_never_exposes_a_setter_for_the_full_key(): void
    {
        $methods = get_class_methods(Aivastra_Connection_Settings::class);
        foreach ($methods as $method) {
            $this->assertStringNotContainsStringIgnoringCase('full_key', $method);
        }
    }
}

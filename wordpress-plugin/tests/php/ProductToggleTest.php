<?php
declare(strict_types=1);

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase;

final class ProductToggleTest extends TestCase
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

    public function test_sanitize_checkbox_accepts_a_truthy_posted_value(): void
    {
        $this->assertSame('1', Aivastra_Product_Toggle::sanitize_checkbox('1'));
    }

    public function test_sanitize_checkbox_treats_a_missing_value_as_disabled(): void
    {
        $this->assertSame('0', Aivastra_Product_Toggle::sanitize_checkbox(null));
    }

    public function test_is_enabled_defaults_true_for_a_product_never_saved(): void
    {
        Functions\expect('get_post_meta')
            ->once()
            ->with(42, '_aivastra_tryon_enabled', true)
            ->andReturn('');

        $this->assertTrue(Aivastra_Product_Toggle::is_enabled(42));
    }

    public function test_is_enabled_true_when_explicitly_saved_as_enabled(): void
    {
        Functions\expect('get_post_meta')->once()->andReturn('1');
        $this->assertTrue(Aivastra_Product_Toggle::is_enabled(42));
    }

    public function test_is_enabled_false_when_explicitly_disabled(): void
    {
        Functions\expect('get_post_meta')->once()->andReturn('0');
        $this->assertFalse(Aivastra_Product_Toggle::is_enabled(42));
    }
}

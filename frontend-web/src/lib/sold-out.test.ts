import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from './api.ts';
import { SoldOutError, isSoldOutError } from './sold-out.ts';
import { checkoutFailureCopy } from './user-facing-checkout-error.ts';

test('checkoutFailureCopy maps SoldOutError to Places finies', () => {
    const copy = checkoutFailureCopy(new SoldOutError('student'));
    assert.equal(copy.title, 'Places finies');
});

test('checkoutFailureCopy maps ApiError sold_out', () => {
    const copy = checkoutFailureCopy(new ApiError("Ce pass n'est plus disponible.", { code: 'sold_out', status: 409 }));
    assert.equal(copy.title, 'Places finies');
});

test('isSoldOutError detects 409 availability message', () => {
    assert.equal(
        isSoldOutError(new ApiError('Ce pass n est plus disponible.', { code: 'http_409', status: 409 })),
        true,
    );
});
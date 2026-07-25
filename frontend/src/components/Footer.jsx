import React from 'react'
import { assets } from '../assets/assets'
import { useNavigate } from 'react-router-dom'

const Footer = () => {

    const navigate = useNavigate()

    return (
        <div className='md:mx-10'>
            <div className='flex flex-col sm:grid grid-cols-[3fr_1fr_1fr] gap-14 my-10 mt-40 text-sm'>

                {/* ---------- Left Section ------- */}
                <div>
                    <img className='mb-5 w-40' src={assets.logo} alt="" />
                    <p className='w-dull md:w-2/3 text-gray-600 leading-6'>Prescripto is a doctor appointment booking platform that connects patients with trusted doctors across a range of specialities. Browse doctors, view their details, and book appointments online in a few clicks.</p>
                </div>

                {/* ---------- Center Section ------- */}
                <div>
                    <p className='text-xl font-medium mb-5'>COMPANY</p>
                    <ul className='felx flex-col gap-2 text-gray-600'>
                        <li onClick={() => { navigate('/'); scrollTo(0, 0); }} className='cursor-pointer hover:text-black'>Home</li>
                        <li onClick={() => { navigate('/about'); scrollTo(0, 0); }} className='cursor-pointer hover:text-black'>About Us</li>
                        <li onClick={() => { navigate('/contact'); scrollTo(0, 0); }} className='cursor-pointer hover:text-black'>Contact Us</li>
                    </ul>
                </div>

                {/* ---------- Right Section ------- */}
                <div>
                    <p className='text-xl font-medium mb-5'>GET IN TOUCH</p>
                    <ul className='felx flex-col gap-2 text-gray-600'>
                        <li>+962795125165</li>
                        <li>admin@prescripto.com</li>
                    </ul>
                </div>
            </div>
            <div>
                {/* --------- Copyright Text ------ */}
                <div>
                    <hr />
                    <p className='py-5 text-sm text-center'>Copyright 2026 © Prescripto - All Rights Reserved. </p>
                </div>

            </div>
        </div>
    )
}

export default Footer
